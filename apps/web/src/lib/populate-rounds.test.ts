import { describe, expect, it } from "vitest";
import { commitInRounds, type RoundSteps } from "./populate-rounds";

/** A document named `name` linking to `links` (other documents or assets). */
interface Doc {
  name: string;
  links: string[];
}

function harness(opts: { registered?: string[]; budget?: number; commitDone?: boolean } = {}) {
  const registered = new Set(opts.registered ?? []);
  const log: string[] = [];
  let ticks = 0;
  const steps: RoundSteps<Doc> = {
    resolve: async (d) => (d.links.every((l) => registered.has(l)) ? d : null),
    commit: async (ds) => {
      log.push(`commit ${ds.map((d) => d.name).join(",")}`);
      return opts.commitDone === false ? { done: false, remaining: ds.length } : { done: true, remaining: 0 };
    },
    register: async (ds) => {
      ds.forEach((d) => registered.add(d.name));
      log.push(`register ${ds.map((d) => d.name).join(",")}`);
    },
    outOfTime: () => ++ticks > (opts.budget ?? Infinity),
  };
  return { steps, log };
}

describe("commitInRounds", () => {
  it("[P5.B.3.b] documents linking only to assets go in one round, with no extra registration", async () => {
    const { steps, log } = harness({ registered: ["fig.svg"] });
    const r = await commitInRounds([{ name: "ch1", links: ["fig.svg"] }, { name: "ch2", links: [] }], steps);
    expect(r).toMatchObject({ kind: "done", unresolved: [] });
    expect(log).toEqual(["commit ch1,ch2"]);
  });

  it("[P5.B.3.b] a document linking to another document of the same upload waits one round", async () => {
    const { steps, log } = harness({ registered: ["fig.svg"] });
    const r = await commitInRounds(
      [
        { name: "guide", links: ["practice"] },
        { name: "practice", links: ["fig.svg"] },
      ],
      steps,
    );
    expect(r).toMatchObject({ kind: "done", unresolved: [] });
    expect(log).toEqual(["commit practice", "register practice", "commit guide"]);
  });

  it("[P5.B.3.b] chains resolve over as many rounds as they need", async () => {
    const { steps, log } = harness();
    await commitInRounds(
      [
        { name: "a", links: ["b"] },
        { name: "b", links: ["c"] },
        { name: "c", links: [] },
      ],
      steps,
    );
    expect(log.filter((l) => l.startsWith("commit"))).toEqual(["commit c", "commit b", "commit a"]);
  });

  it("[P5.B.3.b] a broken link or a cycle is reported, never committed, and the loop ends", async () => {
    const { steps, log } = harness();
    const r = await commitInRounds(
      [
        { name: "a", links: ["b"] },
        { name: "b", links: ["a"] },
        { name: "lost", links: ["missing.svg"] },
        { name: "fine", links: [] },
      ],
      steps,
    );
    expect(r.kind).toBe("done");
    if (r.kind === "done") expect(r.unresolved.map((d) => d.name).sort()).toEqual(["a", "b", "lost"]);
    expect(log).toEqual(["commit fine", "register fine"]);
  });

  it("[P5.B.3.b] out of time: nothing of the unfinished round is lost, all of it is handed on", async () => {
    const { steps, log } = harness({ budget: 1 });
    const r = await commitInRounds(
      [
        { name: "a", links: [] },
        { name: "b", links: [] },
      ],
      steps,
    );
    expect(r).toEqual({ kind: "partial", remaining: 2 });
    expect(log).toEqual([]);
  });

  it("[P5.B.3.b] a commit that runs out of time reports its remainder plus the held documents", async () => {
    const { steps } = harness({ commitDone: false });
    const r = await commitInRounds(
      [
        { name: "a", links: [] },
        { name: "b", links: ["a"] },
      ],
      steps,
    );
    expect(r).toEqual({ kind: "partial", remaining: 2 });
  });

  it("[P5.B.3.b] cost limit: a forward chain of N documents commits in N rounds (N(N+1)/2 resolves); a prev+next ring commits nothing", async () => {
    const N = 30;
    const run = async (links: (i: number) => number[]) => {
      const registered = new Set<string>();
      let resolves = 0;
      let commits = 0;
      const r = await commitInRounds(
        Array.from({ length: N }, (_, i) => ({ name: `d${i}`, links: links(i).map((j) => `d${j}`) })),
        {
          resolve: async (d) => (resolves++, d.links.every((l) => registered.has(l)) ? d : null),
          commit: async () => (commits++, { done: true, remaining: 0 }),
          register: async (ds) => ds.forEach((d) => registered.add(d.name)),
          outOfTime: () => false,
        },
      );
      return { r, resolves, commits };
    };

    const chain = await run((i) => (i < N - 1 ? [i + 1] : []));
    expect(chain.commits).toBe(N);
    expect(chain.resolves).toBe((N * (N + 1)) / 2); // 465 for N = 30
    expect(chain.r).toMatchObject({ kind: "done", unresolved: [] });

    const ring = await run((i) => [i - 1, i + 1].filter((j) => j >= 0 && j < N));
    expect(ring.commits).toBe(0);
    expect(ring.r.kind === "done" && ring.r.unresolved).toHaveLength(N);
  });
});

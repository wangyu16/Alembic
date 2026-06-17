# Demo content — "Motion in One Dimension" (Physics)

A small worked sample for trying Alembic in **physics**. One module, three
sections — enough to see equations, vectors, and a worked example render
natively. Companion to the chemistry sample in [DemoContent.md](../DemoContent.md).

- **Title:** `Motion in One Dimension`
- **License:** `CC-BY-4.0`

---

## Study guide (paste one section per block)

### Section 1 — Position, velocity, acceleration

```
Motion is how an object's **position** $x$ changes with time $t$. The rate of
change of position is the **velocity**:

$$v = \frac{dx}{dt}$$

and the rate of change of velocity is the **acceleration**:

$$a = \frac{dv}{dt} = \frac{d^2x}{dt^2}$$

All three are vectors in general ($\vec{x}$, $\vec{v}$, $\vec{a}$); in one
dimension we track only their sign — positive one way along the line, negative
the other.
```

### Section 2 — The kinematic equations (constant acceleration)

```
When acceleration $a$ is constant, three equations connect the motion. With
initial position $x_0$ and initial velocity $v_0$:

$$v = v_0 + a t$$
$$x = x_0 + v_0 t + \tfrac{1}{2} a t^2$$
$$v^2 = v_0^2 + 2 a\,(x - x_0)$$

Pick the equation that contains the three quantities you know and the one you
want — you never need calculus to solve a constant-acceleration problem.
```

### Section 3 — Free fall

```
Near Earth's surface, gravity gives every object the same downward acceleration
(ignoring air resistance):

$$g \approx 9.8\ \text{m/s}^2$$

**Worked example.** A ball is dropped ($v_0 = 0$) from rest. How fast is it
moving after $t = 2.0\ \text{s}$? Using $v = v_0 + a t$ with $a = g$:

$$v = 0 + (9.8\ \text{m/s}^2)(2.0\ \text{s}) = 19.6\ \text{m/s}.$$
```

> Notation cheat-sheet (renders automatically): inline math `$v = v_0 + at$`,
> display math `$$...$$`, vectors `$\vec{v}$`, fractions `\frac{dx}{dt}`,
> units in `\text{...}`.

---

## Concept map + objectives (the planning layer)

Open **Plan** and add these concepts, links, and objectives.

**Concepts & prerequisites:**

- `Position` → rate of change → `Velocity`
- `Velocity` → rate of change → `Acceleration`
- `Constant acceleration` → enables → `Kinematic equations`
- `Kinematic equations` → applied to → `Free fall`

**Per-topic learning objectives:**

| Topic | Objective (students will be able to…) |
|---|---|
| Position/velocity/acceleration | define each as a rate of change and assign signs in 1-D |
| Kinematic equations | choose and apply the right constant-$a$ equation |
| Free fall | solve a free-fall problem using $g$ |

---

## AI prompts to try

- **Draft a section:** *"Explain why the three kinematic equations only hold for
  constant acceleration, using a velocity–time graph."*
- **Generate a worksheet:** tick Sections 2–3 → *Generate worksheet*. Expect a
  few numeric problems on $v = v_0 + at$ and free fall.

---

## Private instructor material (never reaches the public repo)

**Instructor note (private):**

```
Sign-convention pitfall: students often plug g = +9.8 while taking "up" as
positive, then are surprised the ball speeds up going down. Fix a positive
direction first, then g carries the matching sign. Make them state the choice
before computing.
```

After publishing, confirm it never leaked:
`gh api repos/<you>/motion-in-one-dimension-oer/git/trees/main?recursive=1 | grep -i private` → empty.

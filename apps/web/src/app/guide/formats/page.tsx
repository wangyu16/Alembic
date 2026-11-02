import { GuideExample, GuideNote, GuidePageShell, GuideSection } from "../_components/guide-page-shell";

export const metadata = {
  title: "Writing formats — Alembic Guide",
  description:
    "How to write in Alembic documents, with examples: headings, emphasis, lists, tables, pictures, math, chemistry, boxes, tabs, multiple-choice questions, and slides.",
};

export default function FormatsPage() {
  return (
    <GuidePageShell
      slug="formats"
      title="Writing formats"
      lede="Documents are plain text with a few marks for formatting, a kind of writing called Markdown. Type the marks on the left; the finished page appears on the right. Every example on this page can be copied as it is."
    >
      <GuideSection heading="The settings lines at the top">
        <p>
          Every document begins with a few lines between <code>{"{{nyml"}</code> and{" "}
          <code>{"}}"}</code>. They hold its settings. Change the title if you like;
          leave the rest.
        </p>
        <GuideExample>{"{{nyml\nkind: document\nformat: 1\ntitle: Gases\nuid: doc-…\n}}"}</GuideExample>
      </GuideSection>

      <GuideSection heading="Headings, emphasis and lists">
        <GuideExample label="A line starting with # is the page title; ## starts a section, ### a smaller one.">
          {"# Gases\n\n## Pressure\n\n### Units of pressure"}
        </GuideExample>
        <p>
          In a study guide, each <code>##</code> section is its own place when two
          people write at once, so give each topic its own <code>##</code> heading.
        </p>
        <GuideExample label="Bold, italic, highlighted, subscript and superscript.">
          {"**bold**   *italic*   ==highlighted==   H~2~O   x^2^"}
        </GuideExample>
        <GuideExample label="Lists: a dash for bullets, a number and a full stop for steps. Leave an empty line before a list.">
          {"- Boyle's law\n- Charles's law\n\n1. Write the balanced equation.\n2. Convert grams to moles."}
        </GuideExample>
      </GuideSection>

      <GuideSection heading="Tables">
        <GuideExample label="Columns are separated by |; the second line marks the header.">
          {"| Gas | Molar mass (g/mol) |\n| --- | ---: |\n| N~2~ | 28.02 |\n| O~2~ | 32.00 |"}
        </GuideExample>
      </GuideSection>

      <GuideSection heading="Links and pictures">
        <GuideExample label="A link, and a picture from the web. Always describe the picture in the square brackets.">
          {"[NIST Chemistry WebBook](https://webbook.nist.gov)\n\n![A mercury barometer](https://…/barometer.png)"}
        </GuideExample>
      </GuideSection>

      <GuideSection heading="Math">
        <GuideExample label="Between single dollar signs inside a sentence; between double dollar signs on a line of its own.">
          {"The ideal gas law is $PV = nRT$.\n\n$$\nK_c = \\frac{[\\mathrm{NH_3}]^2}{[\\mathrm{N_2}][\\mathrm{H_2}]^3}\n$$"}
        </GuideExample>
      </GuideSection>

      <GuideSection heading="Chemistry">
        <GuideExample label="Formulas and equations: \ce{…} inside dollar signs. Numbers become subscripts, charges go after ^, arrows are -> and <=>.">
          {"$\\ce{2H2 + O2 -> 2H2O}$\n\n$\\ce{Fe^{2+} + 2e- -> Fe}$\n\n$\\ce{N2 + 3H2 <=> 2NH3}$"}
        </GuideExample>
        <GuideExample label="A structure drawn from its SMILES string (here, ethanol).">
          {"{{smiles CCO}}"}
        </GuideExample>
      </GuideSection>

      <GuideSection heading="Boxes and coloured words">
        <GuideExample label="A box: info, success, warning or danger. Three colons open it and three close it.">
          {"::: info\n**Key idea:** pressure is force per unit area.\n:::\n\n::: warning\nWatch the units: use kelvin, not °C.\n:::"}
        </GuideExample>
        <GuideExample label="A coloured word or a small badge inside a sentence: red, yellow, green, blue, or success, info, warning, danger.">
          {"This step is {{span[red] easy to forget}}. {{span[info] Key term}}"}
        </GuideExample>
        <GuideExample label="Something to click open, such as a hint.">
          {"::: spoil Show a hint\nStart from the number of moles.\n:::"}
        </GuideExample>
      </GuideSection>

      <GuideSection heading="Tabs and practice questions">
        <p>
          Practice questions use tabs: one tab for the question, one for the answer.
          The outer mark has four colons, each tab three.
        </p>
        <GuideExample>
          {":::: tabs\n::: tab Q 1\n*multiple-choice* Which gas law relates pressure and volume at constant temperature?\n\nA. Boyle's law\\\nB. Charles's law\\\nC. Avogadro's law\\\nD. Dalton's law\n:::\n::: tab Answer\n**A.** At constant temperature, $P_1V_1 = P_2V_2$.\n:::\n::::"}
        </GuideExample>
        <GuideNote>
          <p>
            <strong>Multiple-choice options:</strong> end every option line but the last
            with a backslash <code>\</code>, as above. Without it the options run
            together into one line. Write <code>A.</code> rather than <code>(A)</code>:
            the letter <code>(C)</code> in brackets turns into the © sign unless you
            write <code>\(C)</code>.
          </p>
        </GuideNote>
      </GuideSection>

      <GuideSection heading="Diagrams and charts">
        <GuideExample label="A flowchart.">
          {"{{mermaid\ngraph LR\nA[Mass] --> B[Moles] --> C[Particles]\n}}"}
        </GuideExample>
        <GuideExample label="A chart: bar, line, pie, doughnut, radar or polarArea.">
          {"{{chart\ntype: line\nlabels: 0, 10, 20, 30\nseries: Volume (L) = 22.4, 23.2, 24.0, 24.8\n}}"}
        </GuideExample>
      </GuideSection>

      <GuideSection heading="Slides">
        <p>
          A deck is one document. Each slide starts with a line{" "}
          <code>{"<!-- slide -->"}</code>; a <code>##</code> heading under it is the
          slide&rsquo;s title.
        </p>
        <GuideExample label="A title slide, a plain slide, a two-column slide, and speaker notes.">
          {"<!-- slide template=title -->\n# Gases\n## Pressure, volume and temperature\n\n<!-- slide -->\n## Today\n- Pressure and its units\n- Boyle's law\n\n<!-- slide 2col -->\n## Boyle's law\n<!-- @left -->\n$PV = \\text{constant}$\n<!-- @right -->\n- Halve the volume\n- Double the pressure\n<!-- @notes -->\nAsk who has used a bicycle pump."}
        </GuideExample>
        <ul>
          <li>
            <code>template=</code> gives a special page: <code>title</code>,{" "}
            <code>section</code>, <code>outline</code> or <code>closing</code>.
          </li>
          <li>
            Layouts: <code>2col</code>, <code>3col</code>, <code>2row</code>,{" "}
            <code>main-side</code>, <code>quad</code>, with boxes filled by{" "}
            <code>{"<!-- @left -->"}</code>, <code>{"<!-- @right -->"}</code> and so on.
          </li>
          <li>
            <code>{"<!-- @notes -->"}</code> starts the speaker notes for that slide; they
            show only in the speaker view.
          </li>
          <li>
            The look of the whole deck (theme, 16:9 or 4:3, slide numbers) is set with
            the buttons above the editor.
          </li>
          <li>
            If a slide has too much on it, its text shrinks to fit; past a point the
            slide is marked, and <strong>Issues</strong> lists it.
          </li>
        </ul>
      </GuideSection>

      <GuideSection heading="The full reference">
        <p>
          Alembic documents use the orz formats. Their own pages show everything they
          can do, live:
        </p>
        <ul>
          <li>
            <a href="https://markdown.orz.how/features.html">Features of orz-markdown</a>:
            math, diagrams, charts, boxes, columns and more.
          </li>
          <li>
            <a href="https://markdown.orz.how/slides.html">orz-slides</a>: every slide
            layout, template and theme.
          </li>
          <li>
            <a href="https://markdown.orz.how/guide.html">The orz-markdown guide</a>.
          </li>
        </ul>
      </GuideSection>
    </GuidePageShell>
  );
}

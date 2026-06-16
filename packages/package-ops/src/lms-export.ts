import type { QuestionItem, AnswerKey } from "@alembic/package-contract";

/**
 * One-way LMS export (M25 durable core). Instructors export a generated
 * question set to their own LMS (Canvas/Moodle) as IMS Common Cartridge —
 * a ZIP (`.imscc`) wrapping an `imsmanifest.xml` + a QTI 1.2 question file.
 *
 * Because this is the instructor's own export to their LMS, it legitimately
 * includes correct answers. PURE: no IO, no network, no framework imports.
 * Output is deterministic (no timestamps/random).
 */

/** A question item paired with its instructor-only answer key. */
export interface ExportEntry {
  item: QuestionItem;
  key: AnswerKey;
}

export interface LmsExportInput {
  title: string;
  items: ExportEntry[];
}

// --- XML escaping -----------------------------------------------------------

/** XML-escape dynamic text (element content & attribute values). */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Stable choice ident for a 0-based index: C0, C1, … */
function choiceIdent(index: number): string {
  return `C${index}`;
}

// --- QTI 1.2 ----------------------------------------------------------------

function buildMcqItem(entry: ExportEntry, index: number): string {
  const { item, key } = entry;
  const itemIdent = `ITEM_${index}`;
  const responseIdent = `RESPONSE_${index}`;

  // Which choice matches the answer (exact string match)? Fall back to 0.
  let correctIndex = item.choices.findIndex((c) => c === key.answer);
  if (correctIndex < 0) correctIndex = 0;
  const correctIdent = choiceIdent(correctIndex);

  const labels = item.choices
    .map(
      (choice, i) =>
        `          <response_label ident="${choiceIdent(i)}">\n` +
        `            <material><mattext texttype="text/plain">${xmlEscape(choice)}</mattext></material>\n` +
        `          </response_label>`,
    )
    .join("\n");

  const rationale = key.rationale ? key.rationale : "";

  return (
    `    <item ident="${itemIdent}" title="${xmlEscape(item.id)}">\n` +
    `      <presentation>\n` +
    `        <material><mattext texttype="text/html">${xmlEscape(item.stem)}</mattext></material>\n` +
    `        <response_lid ident="${responseIdent}" rcardinality="Single">\n` +
    `          <render_choice>\n` +
    `${labels}\n` +
    `          </render_choice>\n` +
    `        </response_lid>\n` +
    `      </presentation>\n` +
    `      <resprocessing>\n` +
    `        <outcomes>\n` +
    `          <decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/>\n` +
    `        </outcomes>\n` +
    `        <respcondition continue="No">\n` +
    `          <conditionvar>\n` +
    `            <varequal respident="${responseIdent}">${correctIdent}</varequal>\n` +
    `          </conditionvar>\n` +
    `          <setvar action="Set" varname="SCORE">100</setvar>\n` +
    `          <displayfeedback feedbacktype="Response" linkrefid="correct_fb"/>\n` +
    `        </respcondition>\n` +
    `      </resprocessing>\n` +
    `      <itemfeedback ident="correct_fb">\n` +
    `        <material><mattext texttype="text/html">${xmlEscape(key.answer)}${rationale ? " — " + xmlEscape(rationale) : ""}</mattext></material>\n` +
    `      </itemfeedback>\n` +
    `    </item>`
  );
}

function buildOpenResponseItem(entry: ExportEntry, index: number): string {
  const { item, key } = entry;
  const itemIdent = `ITEM_${index}`;
  const responseIdent = `RESPONSE_${index}`;

  const rationale = key.rationale ? key.rationale : "";

  return (
    `    <item ident="${itemIdent}" title="${xmlEscape(item.id)}">\n` +
    `      <presentation>\n` +
    `        <material><mattext texttype="text/html">${xmlEscape(item.stem)}</mattext></material>\n` +
    `        <response_str ident="${responseIdent}" rcardinality="Single">\n` +
    `          <render_fib><response_label ident="A1"/></render_fib>\n` +
    `        </response_str>\n` +
    `      </presentation>\n` +
    `      <resprocessing>\n` +
    `        <outcomes>\n` +
    `          <decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/>\n` +
    `        </outcomes>\n` +
    `      </resprocessing>\n` +
    `      <itemfeedback ident="model_answer">\n` +
    `        <material><mattext texttype="text/html">${xmlEscape(key.answer)}${rationale ? " — " + xmlEscape(rationale) : ""}</mattext></material>\n` +
    `      </itemfeedback>\n` +
    `    </item>`
  );
}

/**
 * Build an IMS QTI 1.2 `<questestinterop>` XML string with one `<item>` per
 * question inside an `<assessment>`/`<section>`. MCQ items (non-empty
 * `choices`) render a `response_lid`/`render_choice`; open-response items
 * (empty `choices`) render a `response_str` with the model answer in feedback.
 */
export function buildQti12(input: LmsExportInput): string {
  const items = input.items
    .map((entry, i) =>
      entry.item.choices.length > 0
        ? buildMcqItem(entry, i)
        : buildOpenResponseItem(entry, i),
    )
    .join("\n");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2">\n` +
    `  <assessment ident="ASSESSMENT_1" title="${xmlEscape(input.title)}">\n` +
    `    <section ident="SECTION_1">\n` +
    `${items}\n` +
    `    </section>\n` +
    `  </assessment>\n` +
    `</questestinterop>\n`
  );
}

// --- Common Cartridge -------------------------------------------------------

/** Path of the QTI file inside the cartridge. */
const QTI_PATH = "assessment_qti.xml";
/** Resource identifier for the QTI assessment resource. */
const RESOURCE_IDENT = "RES_ASSESSMENT_1";

/**
 * Build the Common Cartridge file set: a minimal IMS Common Cartridge 1.1
 * `imsmanifest.xml` (one resource of type
 * `imsqti_xmlv1p2/imscc_xmlv1p1/assessment` pointing at the QTI file) plus the
 * QTI 1.2 file itself.
 */
export function buildCommonCartridge(
  input: LmsExportInput,
): Array<{ path: string; content: string }> {
  const qti = buildQti12(input);
  const title = xmlEscape(input.title);

  const manifest =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<manifest identifier="MANIFEST_1"\n` +
    `    xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1"\n` +
    `    xmlns:lomimscc="http://ltsc.ieee.org/xsd/imsccv1p1/LOM/manifest"\n` +
    `    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n` +
    `    xsi:schemaLocation="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1 http://www.imsglobal.org/profile/cc/ccv1p1/ccv1p1_imscp_v1p2_v1p0.xsd">\n` +
    `  <metadata>\n` +
    `    <schema>IMS Common Cartridge</schema>\n` +
    `    <schemaversion>1.1.0</schemaversion>\n` +
    `    <lomimscc:lom>\n` +
    `      <lomimscc:general>\n` +
    `        <lomimscc:title><lomimscc:string>${title}</lomimscc:string></lomimscc:title>\n` +
    `      </lomimscc:general>\n` +
    `    </lomimscc:lom>\n` +
    `  </metadata>\n` +
    `  <organizations>\n` +
    `    <organization identifier="ORG_1" structure="rooted-hierarchy">\n` +
    `      <item identifier="ROOT_1">\n` +
    `        <item identifier="ITEM_RES_1" identifierref="${RESOURCE_IDENT}">\n` +
    `          <title>${title}</title>\n` +
    `        </item>\n` +
    `      </item>\n` +
    `    </organization>\n` +
    `  </organizations>\n` +
    `  <resources>\n` +
    `    <resource identifier="${RESOURCE_IDENT}" type="imsqti_xmlv1p2/imscc_xmlv1p1/assessment" href="${QTI_PATH}">\n` +
    `      <file href="${QTI_PATH}"/>\n` +
    `    </resource>\n` +
    `  </resources>\n` +
    `</manifest>\n`;

  return [
    { path: "imsmanifest.xml", content: manifest },
    { path: QTI_PATH, content: qti },
  ];
}

// --- CRC-32 -----------------------------------------------------------------

const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** Standard CRC-32 (IEEE 802.3, polynomial 0xEDB88320) over the bytes. */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC32_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// --- ZIP (STORED / no compression) ------------------------------------------

function writeUint16LE(view: number[], value: number): void {
  view.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeUint32LE(view: number[], value: number): void {
  view.push(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}

/**
 * Dependency-free ZIP writer with STORED (uncompressed) entries. Produces a
 * valid, LMS-importable zip: per-file local header (sig 0x04034b50) + data,
 * then the central directory (sig 0x02014b50) and end-of-central-directory
 * record (sig 0x06054b50). All multi-byte fields little-endian; names and
 * contents UTF-8 encoded. version-needed=20, no data descriptor.
 */
export function zipStore(files: Array<{ path: string; content: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];

  interface Record {
    offset: number;
    crc: number;
    size: number;
    nameBytes: Uint8Array;
  }
  const records: Record[] = [];

  for (const file of files) {
    const nameBytes = encoder.encode(file.path);
    const dataBytes = encoder.encode(file.content);
    const crc = crc32(dataBytes);
    const size = dataBytes.length;
    const offset = local.length;

    // Local file header
    writeUint32LE(local, 0x04034b50); // signature
    writeUint16LE(local, 20); // version needed to extract
    writeUint16LE(local, 0x0800); // flags: bit 11 = UTF-8 names
    writeUint16LE(local, 0); // compression method: 0 = stored
    writeUint16LE(local, 0); // mod time (deterministic)
    writeUint16LE(local, 0); // mod date (deterministic)
    writeUint32LE(local, crc);
    writeUint32LE(local, size); // compressed size
    writeUint32LE(local, size); // uncompressed size
    writeUint16LE(local, nameBytes.length);
    writeUint16LE(local, 0); // extra field length
    for (const b of nameBytes) local.push(b);
    for (const b of dataBytes) local.push(b);

    records.push({ offset, crc, size, nameBytes });
  }

  const centralStart = local.length;
  for (const rec of records) {
    writeUint32LE(central, 0x02014b50); // central dir signature
    writeUint16LE(central, 20); // version made by
    writeUint16LE(central, 20); // version needed to extract
    writeUint16LE(central, 0x0800); // flags: UTF-8 names
    writeUint16LE(central, 0); // compression method: stored
    writeUint16LE(central, 0); // mod time
    writeUint16LE(central, 0); // mod date
    writeUint32LE(central, rec.crc);
    writeUint32LE(central, rec.size); // compressed size
    writeUint32LE(central, rec.size); // uncompressed size
    writeUint16LE(central, rec.nameBytes.length);
    writeUint16LE(central, 0); // extra field length
    writeUint16LE(central, 0); // comment length
    writeUint16LE(central, 0); // disk number start
    writeUint16LE(central, 0); // internal attributes
    writeUint32LE(central, 0); // external attributes
    writeUint32LE(central, rec.offset); // relative offset of local header
    for (const b of rec.nameBytes) central.push(b);
  }
  const centralSize = central.length;

  const end: number[] = [];
  writeUint32LE(end, 0x06054b50); // end of central directory signature
  writeUint16LE(end, 0); // number of this disk
  writeUint16LE(end, 0); // disk with central directory
  writeUint16LE(end, records.length); // entries on this disk
  writeUint16LE(end, records.length); // total entries
  writeUint32LE(end, centralSize);
  writeUint32LE(end, centralStart); // offset of central directory
  writeUint16LE(end, 0); // comment length

  const out = new Uint8Array(local.length + central.length + end.length);
  out.set(local, 0);
  out.set(central, local.length);
  out.set(end, local.length + central.length);
  return out;
}

/** Convenience: build the Common Cartridge file set and zip it (STORED). */
export function exportCommonCartridge(input: LmsExportInput): Uint8Array {
  return zipStore(buildCommonCartridge(input));
}

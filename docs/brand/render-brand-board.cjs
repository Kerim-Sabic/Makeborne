/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS asset build utility. */
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");
const root = path.resolve(__dirname, "../..");
const brandDir = path.join(root, "public/brand");
const mark =
  '<path d="M6 6L28 27V58H6V6Z" fill="#3358D4"/><path d="M28 27L58 6L40 38L28 27Z" fill="#16181D"/><path d="M58 6V58H32L58 6Z" fill="#3358D4"/>';
const light =
  '<path d="M6 6L28 27V58H6V6ZM28 27L58 6L40 38L28 27ZM58 6V58H32L58 6Z" fill="white"/>';
(async () => {
  const hero = await sharp(
    path.join(root, "public/artwork/makeborne-paper-studio.png"),
  )
    .resize(500)
    .png()
    .toBuffer();
  const artwork = `data:image/png;base64,${hero.toString("base64")}`;
  const swatches = [
    ["Canvas", "#F8F7F4"],
    ["Ink", "#16181D"],
    ["Cobalt", "#3358D4"],
    ["Surface", "#FFFFFF"],
    ["Muted", "#5C616D"],
  ]
    .map(
      ([name, color], i) =>
        `<g transform="translate(${56 + i * 113},406)"><rect width="96" height="72" rx="8" fill="${color}" stroke="#DCDDD9"/><text y="94" class="small">${name}</text><text y="114" class="code">${color}</text></g>`,
    )
    .join("");
  const board = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1000" viewBox="0 0 1200 1000"><defs><style>text{font-family:Inter,Arial,sans-serif;fill:#16181D}.small{font-size:14px}.code{font-size:12px;fill:#5C616D}.label{font-size:12px;letter-spacing:2px;fill:#5C616D}.serif{font-family:'Source Serif 4',Georgia,serif}</style><clipPath id="art"><rect x="716" y="76" width="428" height="448" rx="16"/></clipPath></defs><rect width="1200" height="1000" fill="#F8F7F4"/><text x="56" y="56" class="label">MAKEBORNE / IDENTITY DIRECTION</text><svg x="52" y="101" width="90" height="90" viewBox="0 0 64 64">${mark}</svg><text x="158" y="164" font-size="64" font-weight="600" letter-spacing="-3">Makeborne</text><text x="56" y="232" font-size="25">Make something worth selling.</text><text x="56" y="279" class="small" fill="#5C616D">Creation and client studio</text><path d="M56 321H632" stroke="#DCDDD9"/><text x="56" y="369" class="label">WARM PAPER. PRECISE INK. CONFIDENT COBALT.</text>${swatches}<image href="${artwork}" x="716" y="76" width="428" height="448" preserveAspectRatio="xMidYMid slice" clip-path="url(#art)"/><text x="716" y="551" class="code">Original generated folded-paper artwork</text><text x="56" y="591" class="label">TYPOGRAPHY</text><text x="56" y="638" font-size="34" font-weight="600" letter-spacing="-1">Clear tools. Exceptional work.</text><text x="56" y="668" class="small">Inter / product interface, controls and wordmark</text><text x="56" y="717" font-size="32" class="serif">An editorial point of view.</text><text x="56" y="746" class="small">Source Serif 4 / selected editorial headings</text><rect x="716" y="598" width="428" height="160" rx="12" fill="#16181D"/><svg x="746" y="637" width="65" height="65" viewBox="0 0 64 64">${light}</svg><text x="829" y="684" font-size="42" font-weight="600" style="fill:#FFFFFF" letter-spacing="-2">Makeborne</text><path d="M56 790H1144" stroke="#DCDDD9"/><text x="56" y="830" class="label">SMALL-SIZE APPLICATIONS / ACTUAL PIXEL SIZES</text><svg x="56" y="856" width="16" height="16" viewBox="0 0 64 64">${mark}</svg><text x="84" y="871" class="small">16px</text><svg x="220" y="853" width="24" height="24" viewBox="0 0 64 64">${mark}</svg><text x="260" y="873" class="small">24px</text><svg x="404" y="849" width="32" height="32" viewBox="0 0 64 64">${mark}</svg><text x="450" y="874" class="small">32px</text><svg x="610" y="841" width="48" height="48" viewBox="0 0 64 64"><path d="M6 6L28 27V58H6V6ZM28 27L58 6L40 38L28 27ZM58 6V58H32L58 6Z" fill="#16181D"/></svg><text x="680" y="875" class="small">Monochrome</text><text x="56" y="952" class="code">Selected top concept • Genuine vector refinement • Fonts depend on viewer availability • Naming clearance pending</text></svg>`;
  fs.writeFileSync(path.join(brandDir, "makeborne-brand-board.svg"), board);
  await sharp(Buffer.from(board))
    .png()
    .toFile(path.join(brandDir, "makeborne-brand-board.png"));
  const samples = [16, 24, 32]
    .map(
      (size, i) =>
        `<g transform="translate(${50 + i * 200},82)"><text y="-24" font-family="Arial" font-size="16" fill="#16181D">${size}px actual size</text><svg width="${size}" height="${size}" viewBox="0 0 64 64">${mark}</svg><svg y="100" width="${size}" height="${size}" viewBox="0 0 64 64">${light}</svg></g>`,
    )
    .join("");
  const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="650" height="280"><rect width="650" height="140" fill="#F8F7F4"/><rect y="140" width="650" height="140" fill="#16181D"/>${samples}</svg>`;
  fs.writeFileSync(path.join(brandDir, "mark-size-review.svg"), sheet);
  await sharp(Buffer.from(sheet))
    .png()
    .toFile(path.join(brandDir, "mark-size-review.png"));
  console.log("Brand board and size review written");
})();

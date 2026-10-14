/* eslint-disable @typescript-eslint/no-require-imports */
// Pure bundled data: no package filesystem resolution in the application runtime.
const {licenses} = require("./font-licenses.json");
module.exports = function fontLicenseFiles(fonts) {
  return fonts.map(font => {
    const license = licenses[font.id];
    if (!license) throw new Error(`Missing trusted font license: ${font.id}`);
    return {path: `public/makeborne-font-licenses/${font.id}.txt`, content: license.content};
  });
};

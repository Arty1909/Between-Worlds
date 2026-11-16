const fs = require('fs');
const path = require('path');
const sharp = require(process.env.SHARP_MODULE || 'sharp');
const root = path.resolve(__dirname, '..');
(async () => {
  const dir = path.join(root, 'assets/branding');
  for (const size of [180, 192, 512]) {
    await sharp(path.join(dir, 'logo.svg')).resize(Math.round(size * .86)).png().toBuffer().then(logo =>
      sharp({create:{width:size,height:size,channels:4,background:'#191725'}})
        .composite([{input:logo,gravity:'centre'}]).png().toFile(path.join(dir, `icon-${size}.png`)));
  }
})();

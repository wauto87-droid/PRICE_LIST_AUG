import sharp from "sharp";
for (const size of [192, 512])
  await sharp("public/logo.svg")
    .resize(size, size, { fit: "contain", background: "#ffffff" })
    .png()
    .toFile(`public/icon-${size}.png`);
await sharp("public/logo.svg")
  .resize(320, 320, { fit: "contain", background: "#ffffff" })
  .extend({ top: 96, bottom: 96, left: 96, right: 96, background: "#ffffff" })
  .png()
  .toFile("public/icon-maskable.png");

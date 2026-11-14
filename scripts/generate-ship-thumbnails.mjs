import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const output = fileURLToPath(new URL('../assets/images/ships/', import.meta.url));
await mkdir(output, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  protocolTimeout: 180000,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--mute-audio'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(process.env.RIFT_TEST_URL || 'http://localhost:8000/', {
    waitUntil: 'domcontentloaded', timeout: 120000,
  });
  await page.waitForFunction(() => window.RIFT?.hangar && !document.getElementById('launchBtn').disabled,
    { timeout: 120000 });
  await page.click('#shipSelectBtn');
  await page.waitForFunction(() => Boolean(window.RIFT.hangar.renderer), { timeout: 120000 });

  const thumbnails = await page.evaluate(() => {
    const hangar = window.RIFT.hangar;
    const width = 560, height = 360;
    hangar.renderer.setPixelRatio(1);
    hangar.renderer.setSize(width, height, false);
    hangar.camera.aspect = width / height;
    hangar.camera.fov = 30;
    hangar.camera.position.set(6.2, 4.1, -8.2);
    hangar.camera.lookAt(0, 0, 0);
    hangar.camera.updateProjectionMatrix();
    return hangar.buttons.map((button) => {
      const id = button.dataset.shipId;
      hangar.select(id);
      const model = hangar.models.get(id);
      model.rotation.set(0.08, -0.35, -0.025);
      hangar.renderer.render(hangar.scene, hangar.camera);
      return { id, data: hangar.renderer.domElement.toDataURL('image/webp', 0.9) };
    });
  });

  for (const { id, data } of thumbnails) {
    const encoded = data.replace(/^data:image\/webp;base64,/, '');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length < 1000 || bytes.subarray(0, 4).toString('hex') !== '52494646') {
      throw new Error(`Invalid WebP render for ${id}`);
    }
    await writeFile(`${output}${id}.webp`, bytes);
    console.log(`${id}: ${(bytes.length / 1024).toFixed(1)} KiB`);
  }
} finally {
  await browser.close();
}

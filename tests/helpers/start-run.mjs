/** Complete the real first-launch default-name path before testing gameplay. */
export async function launchRun(page) {
  await page.click('#launchBtn');
  if (await page.$('#pilotIdentityDialog[open]')) await page.click('#pilotNameConfirm');
}

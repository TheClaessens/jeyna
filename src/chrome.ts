// Which browser Jeyna launches, for playtests (browser.ts) and the studio's Live window (D37): the installed Chrome,
// else Playwright's Chromium (D13). JEYNA_BROWSER_CHANNEL overrides the channel, which is how P4 forces the fallback.
// `open` launches with the channel it is given; undefined means Playwright's own Chromium.
import pw from "playwright-core/package.json" with { type: "json" };

const log = (...a: unknown[]) => console.error(new Date().toISOString(), ...a);

export async function launchChrome<T>(open: (channel: string | undefined) => Promise<T>): Promise<T> {
  const channel = process.env.JEYNA_BROWSER_CHANNEL ?? "chrome";
  let why: string;
  try {
    const b = await open(channel);
    log(`launched channel ${channel}`);
    return b;
  } catch (e) {
    why = (e as Error).message.split("\n")[0];
    log(`${channel} launch failed:`, why);
  }
  try {
    const b = await open(undefined);
    log("using Playwright's Chromium");
    return b;
  } catch {
    throw new Error(
      `No browser found. Google Chrome (channel "${channel}") did not launch: ${why}. ` +
        `Install Google Chrome, or install Playwright's Chromium: npx playwright install chromium ` +
        `(if it still is not found, pin the version Jeyna bundles: npx playwright@${pw.version} install chromium).`,
    );
  }
}

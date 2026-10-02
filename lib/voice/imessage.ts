// Owner: Laksh. Sends a text to the attorney's own phone through Messages.app on the Mac running this app.
// The recipient comes only from IMESSAGE_TO in .env, never from the model, so the agent cannot text anyone else.
import { execFile } from "node:child_process";

// Message and recipient are passed as arguments, never pasted into the script, so text cannot inject AppleScript.
// `participant` is the name on current macOS; older versions call it `buddy`.
const SCRIPT = `
on run argv
  set msg to item 1 of argv
  set target to item 2 of argv
  tell application "Messages"
    set svc to 1st account whose service type = iMessage
    try
      send msg to participant target of svc
    on error
      send msg to buddy target of svc
    end try
  end tell
end run`;

export function imessageTarget(): string | null {
  return process.env.IMESSAGE_TO?.trim() || null;
}

export function sendIMessage(text: string): Promise<{ ok: true; to: string } | { ok: false; error: string }> {
  const to = imessageTarget();
  if (!to) return Promise.resolve({ ok: false, error: "IMESSAGE_TO is not set in .env" });
  if (process.platform !== "darwin") return Promise.resolve({ ok: false, error: "iMessage needs the app running on a Mac" });
  return new Promise((resolve) => {
    execFile("osascript", ["-e", SCRIPT, text, to], { timeout: 20_000 }, (err, _out, stderr) => {
      if (!err) return resolve({ ok: true, to });
      // -1743: macOS has not allowed this app to control Messages yet.
      const msg = /-1743|not allowed/i.test(stderr)
        ? "macOS blocked control of Messages. Allow it in System Settings > Privacy & Security > Automation, then try again."
        : (stderr || err.message).trim().slice(0, 300);
      resolve({ ok: false, error: msg });
    });
  });
}

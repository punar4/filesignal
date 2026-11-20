# FileSignal Ready: setup (Windows, about 20 minutes)

## A. Run it on your laptop

1. Unzip `filesignal-ready.zip` into `Documents\projects\`. You should now have `Documents\projects\filesignal-ready\`.
2. Open VS Code → **File → Open Folder** → select `filesignal-ready` → **Select Folder**. If asked "Do you trust the authors?", click **Yes**.
3. Open the terminal: **View → Terminal** (or `` Ctrl + ` ``).
4. Run these one at a time and wait for each to finish:

   | Command | You should see |
   |---|---|
   | `node -v` | `v20...` or higher |
   | `npm install` | "added ... packages", 0 vulnerabilities |
   | `npm test` | `# pass 11` and `# fail 0` |
   | `npm start` | `FileReady on http://localhost:3000` |

5. Open **http://localhost:3000** in Chrome. The sample company loads with "₹51,660 of October's ITC can't be claimed yet…".
6. Click **Download Excel report**. A file `fileready-2026-10.xlsx` should download and open in Excel.
7. Go back to the terminal and press `Ctrl + C` to stop the app.

## B. Put it on GitHub

8. Go to **github.com → New repository**.
   - Name: `filesignal`
   - Visibility: **Private**
   - Do **not** tick "Add a README", .gitignore or licence.
   - Click **Create repository**.
9. In the VS Code terminal, paste this one line and press Enter:

   ```
   git init; git add .; git commit -m "FileSignal Ready v1"; git branch -M main; git remote add origin https://github.com/punar4/filesignal.git; git push -u origin main
   ```

   If a GitHub login window pops up, sign in. Refresh the GitHub page and your files should be there.

## C. Put it online (Render, free)

10. Go to **render.com** → **Sign in with GitHub**.
11. **New + → Blueprint** → connect/select the `filesignal` repo → **Apply**. Render reads `render.yaml` and builds it. The first build takes 3–6 minutes.
12. When the status says **Live**, open the URL shown, for example `https://filesignal.onrender.com`. Render adds a suffix if the name is taken.
13. Check that the sample loads and **Download Excel report** works on the live link, on your phone too.

## D. Stop it from sleeping

14. Go to **cron-job.org** → sign up free → **Create cronjob**.
    - URL: `https://<your-render-link>/health`
    - Schedule: **every 10 minutes**
    - Save.
15. Opening `https://<your-render-link>/health` in a browser should show `{"ok":true}`.

## E. Optional: make it private

16. In Render → your service → **Environment → Add environment variable**: key `ACCESS_KEY`, value a long random password. Save. The app then asks for that key before running a check. Share the key only with Arthaveda.

## If something fails

- `npm` is not recognised → reinstall Node.js 22 LTS from nodejs.org, then reopen VS Code.
- `git push` is rejected → the repo wasn't empty. Delete it and recreate it without a README.
- Render build fails → open the **Logs** tab, copy the red lines, and paste them to Claude or Copilot Chat.

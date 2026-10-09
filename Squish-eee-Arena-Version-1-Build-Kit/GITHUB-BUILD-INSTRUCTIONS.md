# Squish-eee Arena — Version 1 — Build a Windows installer with GitHub Actions

This ZIP is prepared for building the Windows `.exe` installers on GitHub's Windows runner. The computer that installs/plays the game does not need Node.js.

## Important: use a separate repository for this version

To avoid mixing the two versions, create a separate GitHub repository for each ZIP. Suggested repository name: `Squish-eee-Arena-Version-1`.

## Upload the project files

1. Extract this ZIP on your PC.
2. On GitHub, create a **new empty repository** named `Squish-eee-Arena-Version-1`. You may choose Public or Private.
3. Open the new repository and choose **Add file → Upload files**.
4. Open the extracted folder in File Explorer. Select **everything inside it**, including the `.github` folder, and drag the selection to GitHub's upload page. **Do not upload the enclosing folder itself**. The repository root must show `package.json` and `.github` side by side.
5. Click **Commit changes**.

The workflow starts automatically after the upload commit. No Node.js installation is required on your own PC to make this work; GitHub performs the build remotely.

## Download the installers

1. Open the repository's **Actions** tab.
2. Click **Build Squish-eee Arena 1** and open the newest run.
3. Wait until it has a green checkmark and says **Success**.
4. Open the run **Summary** and download the artifact named `Squish-eee-Arena-Version-1-Installers`.
5. Extract the downloaded artifact ZIP. Inside are a portable `.exe` and a setup installer `.exe`.

## If it fails

Open the failed run, click the red step, and copy or screenshot the first red error lines. A yellow deprecation warning alone is not the same as a build failure.

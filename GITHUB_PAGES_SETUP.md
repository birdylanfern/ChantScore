# Publish ChantScore on GitHub Pages

1. Create a GitHub repository (or open the existing ChantScore repository).
2. Upload the **contents** of this ZIP to the repository root, including the hidden `.github` directory. Commit to the `main` branch.
3. Open **Settings > Pages** and set **Build and deployment > Source** to **GitHub Actions**.
4. Open **Actions > Deploy Chantscore to GitHub Pages** and run the workflow, or push another commit to `main`.
5. The deployed URL is shown in the workflow's `deploy` job. For a normal project repository it is `https://OWNER.github.io/REPOSITORY/`.

The workflow installs dependencies, runs tests and type checks, builds the static site with the correct Vite base URL, and publishes `dist`.

This project ships with `bun.lock` rather than `package-lock.json`. The workflows therefore use `npm install --no-package-lock` instead of `npm ci`, which requires an npm lockfile. For reproducible npm builds later, generate and commit a `package-lock.json` using `npm install --package-lock-only`, then switch the workflows back to `npm ci`.

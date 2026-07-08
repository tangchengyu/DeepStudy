const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.join(__dirname, "..");
const distDir = path.join(projectRoot, "dist");

function psString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function getDesktopPath() {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", '[Environment]::GetFolderPath("Desktop")'],
    { encoding: "utf8" },
  );

  const desktop = result.stdout && result.stdout.trim();
  return (
    desktop || path.join(process.env.USERPROFILE || process.cwd(), "Desktop")
  );
}

function findLatestExe() {
  if (!fs.existsSync(distDir)) {
    throw new Error(`Build output directory not found: ${distDir}`);
  }

  const unpackedDir = path.join(distDir, "win-unpacked");
  const unpackedExeNames = ["DeepStudy.exe", "deepstudy.exe"];
  for (const exeName of unpackedExeNames) {
    const unpackedExe = path.join(unpackedDir, exeName);
    if (fs.existsSync(unpackedExe)) {
      return unpackedExe;
    }
  }

  const candidates = fs
    .readdirSync(distDir)
    .filter((file) => file.toLowerCase().endsWith(".exe"))
    .map((file) => {
      const fullPath = path.join(distDir, file);
      return {
        fullPath,
        mtimeMs: fs.statSync(fullPath).mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (candidates.length === 0) {
    throw new Error(
      `No .exe file found in ${distDir}. Run npm run pack first.`,
    );
  }

  return candidates[0].fullPath;
}

function createShortcut(targetPath) {
  const desktopPath = getDesktopPath();
  const shortcutPath = path.join(desktopPath, "DeepStudy.lnk");
  const command = [
    "$shell = New-Object -ComObject WScript.Shell",
    `$shortcut = $shell.CreateShortcut(${psString(shortcutPath)})`,
    `$shortcut.TargetPath = ${psString(targetPath)}`,
    `$shortcut.WorkingDirectory = ${psString(path.dirname(targetPath))}`,
    `$shortcut.IconLocation = ${psString(`${targetPath},0`)}`,
    "$shortcut.Save()",
  ].join("; ");

  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    { stdio: "inherit" },
  );

  if (result.status !== 0) {
    throw new Error("Failed to create desktop shortcut.");
  }

  return shortcutPath;
}

try {
  const targetPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : findLatestExe();
  const shortcutPath = createShortcut(targetPath);
  console.log(`Created shortcut: ${shortcutPath}`);
  console.log(`Target: ${targetPath}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

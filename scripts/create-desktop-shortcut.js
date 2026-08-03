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

  const explicitTarget = process.env.DEEPSTUDY_APP_EXE;
  if (explicitTarget && fs.existsSync(explicitTarget)) {
    return explicitTarget;
  }

  const unpackedDir = path.join(distDir, "win-unpacked");
  const unpackedExeNames = ["DeepStudy.exe", "deepstudy.exe"];
  for (const exeName of unpackedExeNames) {
    const unpackedExe = path.join(unpackedDir, exeName);
    if (fs.existsSync(unpackedExe)) {
      return unpackedExe;
    }
  }

  throw new Error(
    `Runnable app executable not found. Run npm run pack:win and use ${path.join(unpackedDir, "DeepStudy.exe")} as the desktop shortcut target. The installer .exe is intentionally not used as a shortcut target.`,
  );
}

function createShortcut(targetPath) {
  if (/setup|install/i.test(path.basename(targetPath))) {
    throw new Error("Desktop shortcut target must be the installed or unpacked app executable, not the installer.");
  }
  const desktopPath = getDesktopPath();
  const shortcutName = process.env.DEEPSTUDY_SHORTCUT_NAME || "DeepStudy";
  const shortcutPath = path.join(desktopPath, `${shortcutName}.lnk`);
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

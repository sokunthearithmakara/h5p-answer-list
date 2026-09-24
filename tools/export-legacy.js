#!/usr/bin/env node
/**
 * Export a content folder as an .h5p package that an older H5P core accepts.
 *
 * The latest releases of many H5P libraries require core API 1.28, which
 * older platforms (e.g. Lumi, which runs core 1.27) refuse to install. For
 * each dependency this picks the newest release with the same major.minor
 * version whose coreApi fits the target core and whose preloaded files are
 * committed (so no build step is needed), and packs it from git history.
 *
 * Files listed in a library's .h5pignore are left out of the package.
 *
 * Usage (from an h5p-cli workspace, i.e. the folder with libraries/ and content/):
 *   node libraries/H5P.AnswerList-1.0/tools/export-legacy.js <content-folder> [coreMinor=27]
 * Output: temp/<content-folder>-core1.<coreMinor>.h5p
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = findWorkspace();
const librariesDir = path.join(root, 'libraries');
const AdmZip = loadAdmZip();

const folder = process.argv[2];
const target = { majorVersion: 1, minorVersion: parseInt(process.argv[3] || '27', 10) };
if (!folder) {
  console.error('Usage: node libraries/H5P.AnswerList-1.0/tools/export-legacy.js <content-folder> [coreMinor=27]');
  process.exit(1);
}

// Same rules as h5p-cli's export, plus skipping hidden folders and node_modules
const ALLOWED = /\.(json|png|jpg|jpeg|gif|bmp|tif|tiff|eot|ttf|woff|woff2|otf|webm|mp4|ogg|mp3|m4a|wav|txt|pdf|rtf|doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|csv|diff|patch|swf|md|textile|vtt|webvtt|gltf|glb|js|css|svg|xml)$/i;
const isPackable = (relPath) => {
  const parts = relPath.split('/');
  if (parts.some((p) => p.startsWith('.') || p === 'node_modules')) {
    return false;
  }
  return ALLOWED.test(parts[parts.length - 1]);
};

const contentDir = path.join(root, 'content', folder);
const h5pJson = readJson(path.join(contentDir, 'h5p.json'));
const contentJson = readJson(path.join(contentDir, 'content.json'));

const zip = new AdmZip();
const resolved = {}; // "Name-1.2" -> { version, source, library }

// Main library, media sub-content libraries and everything they depend on
const wanted = [{ machineName: h5pJson.mainLibrary, ...folderVersion(h5pJson.mainLibrary) }]
  .concat(findContentLibraries(contentJson));
const viewDeps = new Set();
wanted.forEach((dep) => resolve(dep, viewDeps, true));

// h5p.json: list every runtime dependency
h5pJson.preloadedDependencies = [...viewDeps].map((key) => {
  const lib = resolved[key].library;
  return { machineName: lib.machineName, majorVersion: lib.majorVersion, minorVersion: lib.minorVersion };
});
zip.addFile('h5p.json', Buffer.from(JSON.stringify(h5pJson)));

// Content files (skip dev-server sessions)
walk(contentDir).forEach((rel) => {
  if (rel === 'h5p.json' || rel.startsWith('sessions/') || !isPackable(rel)) {
    return;
  }
  zip.addLocalFile(path.join(contentDir, rel), path.posix.dirname('content/' + rel));
});

const outDir = path.join(root, 'temp');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `${folder}-core${target.majorVersion}.${target.minorVersion}.h5p`);
zip.writeZip(out);

console.log(`Target core API: ${target.majorVersion}.${target.minorVersion}\n`);
Object.keys(resolved).sort().forEach((key) => {
  const r = resolved[key];
  const core = r.library.coreApi ? `${r.library.coreApi.majorVersion}.${r.library.coreApi.minorVersion}` : '-';
  console.log(`  ${key.padEnd(34)} ${r.version.padEnd(10)} core ${core.padEnd(5)} ${r.source}`);
});
console.log(`\nWrote ${path.relative(root, out)}`);

/**
 * Pack a library (once) and recurse into its dependencies.
 */
function resolve(dep, runtimeSet, isRuntime) {
  const key = `${dep.machineName}-${dep.majorVersion}.${dep.minorVersion}`;
  if (isRuntime) {
    runtimeSet.add(key);
  }
  if (resolved[key]) {
    return;
  }
  const dir = path.join(librariesDir, key);
  if (!fs.existsSync(dir)) {
    throw new Error(`Library folder not found: libraries/${key}`);
  }

  const pick = pickVersion(dir);
  resolved[key] = pick;
  pick.files.forEach(({ rel, data }) => zip.addFile(`${key}/${rel}`, data));

  const lib = pick.library;
  (lib.preloadedDependencies || []).forEach((d) => resolve(d, runtimeSet, isRuntime));
  (lib.dynamicDependencies || []).forEach((d) => resolve(d, runtimeSet, isRuntime));
  (lib.editorDependencies || []).forEach((d) => resolve(d, runtimeSet, false));
}

/**
 * Use the working tree when it already fits the target core; otherwise the
 * newest compatible, prebuilt commit from git history.
 */
function pickVersion(dir) {
  const head = readJson(path.join(dir, 'library.json'));
  const hasGit = fs.existsSync(path.join(dir, '.git'));

  if (fitsCore(head) && preloadedFiles(head).every((f) => fs.existsSync(path.join(dir, f)))) {
    const ignored = h5pIgnore(fs.existsSync(path.join(dir, '.h5pignore')) ? fs.readFileSync(path.join(dir, '.h5pignore'), 'utf8') : '');
    const files = walk(dir).filter((rel) => isPackable(rel) && !ignored(rel))
      .map((rel) => ({ rel, data: fs.readFileSync(path.join(dir, rel)) }));
    return { library: head, version: versionOf(head), source: hasGit ? 'working tree' : 'working tree (no git)', files };
  }
  if (!hasGit) {
    throw new Error(`${path.basename(dir)} needs core ${coreOf(head)} and has no git history to fall back on`);
  }

  const commits = git(dir, 'rev-list HEAD -- library.json').trim().split('\n');
  for (const commit of commits) {
    let lib;
    try {
      lib = JSON.parse(git(dir, `show ${commit}:library.json`));
    }
    catch (e) {
      continue;
    }
    if (lib.majorVersion !== head.majorVersion || lib.minorVersion !== head.minorVersion || !fitsCore(lib)) {
      continue;
    }
    const tracked = new Set(git(dir, `ls-tree -r --name-only ${commit}`).split('\n'));
    if (!preloadedFiles(lib).every((f) => tracked.has(f))) {
      continue; // would need a build
    }
    const archive = new AdmZip(execSync(`git archive --format=zip ${commit}`, { cwd: dir, maxBuffer: 1 << 28 }));
    const ignoreEntry = archive.getEntry('.h5pignore');
    const ignored = h5pIgnore(ignoreEntry ? archive.readAsText(ignoreEntry) : '');
    const files = archive.getEntries()
      .filter((e) => !e.isDirectory && isPackable(e.entryName) && !ignored(e.entryName))
      .map((e) => ({ rel: e.entryName, data: e.getData() }));
    return { library: lib, version: versionOf(lib), source: `git ${commit.slice(0, 8)}`, files };
  }
  throw new Error(`No release of ${path.basename(dir)} fits core ${target.majorVersion}.${target.minorVersion} without a build`);
}

/**
 * Build a matcher from .h5pignore contents: one path per line, "dir/" for a
 * folder, "*" as a wildcard, "#" for comments.
 */
function h5pIgnore(text) {
  const patterns = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const dirOnly = l.endsWith('/');
      const glob = l.replace(/^\/+|\/+$/g, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
      return new RegExp('^' + glob + (dirOnly ? '/' : '(/|$)'));
    });
  return (rel) => patterns.some((re) => re.test(rel));
}

/**
 * The h5p-cli workspace: the nearest folder (from the current directory, then
 * from this script) that has both libraries/ and content/.
 */
function findWorkspace() {
  for (const start of [process.cwd(), __dirname]) {
    let dir = path.resolve(start);
    while (true) {
      if (fs.existsSync(path.join(dir, 'libraries')) && fs.existsSync(path.join(dir, 'content'))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  }
  console.error('Run this from an h5p-cli workspace (a folder with libraries/ and content/).');
  process.exit(1);
}

function fitsCore(lib) {
  const c = lib.coreApi;
  return !c || c.majorVersion < target.majorVersion ||
    (c.majorVersion === target.majorVersion && c.minorVersion <= target.minorVersion);
}

function preloadedFiles(lib) {
  return [...(lib.preloadedJs || []), ...(lib.preloadedCss || [])].map((f) => f.path);
}

function versionOf(lib) {
  return `${lib.majorVersion}.${lib.minorVersion}.${lib.patchVersion}`;
}

function coreOf(lib) {
  return lib.coreApi ? `${lib.coreApi.majorVersion}.${lib.coreApi.minorVersion}` : '-';
}

/**
 * Sub-content libraries referenced in content.json, e.g. "H5P.Video 1.6".
 */
function findContentLibraries(node, found = []) {
  if (Array.isArray(node)) {
    node.forEach((n) => findContentLibraries(n, found));
  }
  else if (node && typeof node === 'object') {
    if (typeof node.library === 'string') {
      const m = node.library.match(/^(\S+) (\d+)\.(\d+)$/);
      if (m) {
        found.push({ machineName: m[1], majorVersion: +m[2], minorVersion: +m[3] });
      }
    }
    Object.values(node).forEach((n) => findContentLibraries(n, found));
  }
  return found;
}

/**
 * Major/minor of the installed folder for a machine name.
 */
function folderVersion(machineName) {
  const match = fs.readdirSync(librariesDir)
    .map((name) => name.match(new RegExp(`^${machineName.replace('.', '\\.')}-(\\d+)\\.(\\d+)$`)))
    .filter(Boolean)
    .sort((a, b) => (b[1] - a[1]) || (b[2] - a[2]))[0];
  if (!match) {
    throw new Error(`No libraries/${machineName}-x.y folder found`);
  }
  return { majorVersion: +match[1], minorVersion: +match[2] };
}

function walk(dir, base = dir, out = []) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
      return;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, base, out);
    }
    else {
      out.push(path.relative(base, full).split(path.sep).join('/'));
    }
  });
  return out;
}

function git(dir, cmd) {
  return execSync('git ' + cmd, { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26 });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadAdmZip() {
  try {
    return require('adm-zip');
  }
  catch (e) {
    // Reuse the copy that ships with h5p-cli
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return require(path.join(globalRoot, 'h5p-cli', 'node_modules', 'adm-zip'));
  }
}

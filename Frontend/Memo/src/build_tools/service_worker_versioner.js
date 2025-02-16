/**
 * Replaces cache version in the service worker so we get a fresh one at
 * every build.
 * Regenerates the list of files cached by the service worker.
 */

const fs = require("fs");

const version_file = "src/build_tools/version_counter.txt";
const src_dir = "build_worker";
const build_dir = "build";
const files = ["main/worker/service-worker.js"];
const dirs = ["src/main/dom", "src/main/pkg", "images"];
const version_marker = "{AUTOINCREMENT_CACHE_VERSION}";
const all_source_marker = '"{ALL_SOURCES}"';
const exclude = new Set([
  "memo_interfaces.ts",
  "tulip-blue.svg",
  "tulip-green.svg",
]);

const get_next_version = () => {
  let version = parseInt(fs.readFileSync(version_file, "utf8"), 10) + 1;
  console.log("Incrementing versions to", version);

  fs.writeFileSync(version_file, String(version));

  return version;
};

const scan_dir = (dir, exclude) => {
  const suf = dir.split("/").pop();
  return fs
    .readdirSync(dir)
    .filter((f) => f.match(/.+\.(ts|js|svg|wasm)$/))
    .filter((f) => !exclude.has(f))
    .filter((f) => !f.match(/.+\.d\.ts$/))
    .map((f) => f.replace(/\.ts$/, ".js"))
    .map((f) => `"${suf}/${f}"`)
    .reduce((acc, v) => {
      acc.push(v);
      return acc;
    }, []);
};

const get_all_files = () => {
  return dirs.flatMap((d) => scan_dir(d, exclude)).join(",\n    ");
};

/**
 * Invoke the functions that calculate the markup values
 */
const populate_markers = () => {
  return new Map([
    [version_marker, get_next_version()],
    [all_source_marker, get_all_files()],
  ]);
};

/**
 * Replace the markup with it's corresponding value
 * @param {Map<string, string>} markers
 */
const process_files = (markers) => {
  files.forEach((f) => {
    let content = fs.readFileSync(`${src_dir}/${f}`, "utf8");

    markers.forEach((value, key) => {
      content = content.replace(key, value);
    });
    fs.writeFileSync(`${build_dir}/${f}`, content);
  });
};

process_files(populate_markers());

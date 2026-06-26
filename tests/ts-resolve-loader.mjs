import { access } from "node:fs/promises";
import { dirname, extname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CANDIDATE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs"];

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function resolve(specifier, context, defaultResolve) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && extname(specifier) === ".js") {
    const parentPath = context.parentURL?.startsWith("file:")
      ? dirname(fileURLToPath(context.parentURL))
      : process.cwd();
    const tsCandidatePath = resolvePath(parentPath, `${specifier.slice(0, -3)}.ts`);

    if (await pathExists(tsCandidatePath)) {
      return {
        url: pathToFileURL(tsCandidatePath).href,
        shortCircuit: true,
      };
    }
  }

  if ((specifier.startsWith("./") || specifier.startsWith("../")) && extname(specifier) === "") {
    const parentPath = context.parentURL?.startsWith("file:")
      ? dirname(fileURLToPath(context.parentURL))
      : process.cwd();

    for (const extension of CANDIDATE_EXTENSIONS) {
      const candidatePath = resolvePath(parentPath, `${specifier}${extension}`);

      if (await pathExists(candidatePath)) {
        return {
          url: pathToFileURL(candidatePath).href,
          shortCircuit: true,
        };
      }
    }

    const indexCandidates = CANDIDATE_EXTENSIONS.map((extension) => resolvePath(parentPath, specifier, `index${extension}`));

    for (const candidatePath of indexCandidates) {
      if (await pathExists(candidatePath)) {
        return {
          url: pathToFileURL(candidatePath).href,
          shortCircuit: true,
        };
      }
    }
  }

  return defaultResolve(specifier, context, defaultResolve);
}

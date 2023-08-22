import path from "path";

/**
 * Normalize a path to use POSIX separators
 * @param {string} pathToNormalize  The path to normalize
 * @returns {string}
 */
export function normalizePath(pathToNormalize) {
  return path.normalize(pathToNormalize).split(path.sep).join(path.posix.sep);
}

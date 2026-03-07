// Browser shim for Node.js child_process APIs referenced by loaders internals.
// This code path must never run in the browser build.
const unsupported = () => {
  throw new Error('child_process.spawn is not available in the browser runtime');
};

export const spawn = unsupported;
export default { spawn };

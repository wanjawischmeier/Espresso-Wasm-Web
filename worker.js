import { Buffer } from 'buffer/';
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer;
}

import { init, WASI } from '@wasmer/wasi';

const module_cache = {};
let wsmInitialized = false;

addEventListener('message', (event) => {
  // Expect message format: { input, args, wasmPath }
  const { input, args, wasmPath } = event.data || {}
  executeEspresso(input ?? '', args ?? [], wasmPath)
    .then((result) => postMessage(result))
    .catch((err) => postMessage({ exitCode: 1, stdout: '', stderr: String(err) }))
});

/**
 * @param {string} input
 * @param {string[]} args
 * @return {Promise<{exitCode: number, stdout: string, stderr: string}>}
 */
async function executeEspresso(input, args) {
  if (!wsmInitialized) {
    await init()
    wsmInitialized = true
  }

  const wasi = new WASI({ env: {}, args: ['espresso', ...(args || []), '/input.esp'] })

  const file = wasi.fs.open('/input.esp', { read: true, write: true, create: true })
  file.writeString(input ?? '')
  file.flush()

  // Use provided wasmPath or fall back to default location
  const wasmToLoad = typeof wasmPath === 'string' && wasmPath.length > 0 ? wasmPath : 'espresso.wasm'
  await instantiateModule(wasi, wasmToLoad)

  console.debug('Running Espresso...')
  const exitCode = wasi.start()
  console.debug('Espresso finished with exit code', exitCode)
  return {
    exitCode,
    stdout: wasi.getStdoutString(),
    stderr: wasi.getStderrString(),
  }
}

/**
 * @param {string} moduleName
 * @return {Promise<WebAssembly.Module>}
 */
async function getModule(moduleName) {
  if (module_cache[moduleName]) {
    return module_cache[moduleName];
  }

  const wasm = await WebAssembly.compileStreaming(fetch(moduleName));
  module_cache[moduleName] = wasm;
  return wasm;
}

/**
 * @param {WASI} wasi
 * @param {string} moduleName
 * @return {Promise<void>}
 */
async function instantiateModule(wasi, moduleName) {
  const module = await getModule(moduleName);
  const instance = await WebAssembly.instantiate(module, wasi.getImports(module));

  await wasi.instantiate(instance, {});
}

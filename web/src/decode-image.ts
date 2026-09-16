// SPDX-License-Identifier: MIT
/** Decode without retaining a timer or abort listener after any settlement. */
export async function decodeImage(
  image:Pick<HTMLImageElement,'decode'>,
  signal:AbortSignal,
  timeoutMs=20000,
):Promise<void> {
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new RangeError('Invalid image decode timeout');
  signal.throwIfAborted();
  let timer:ReturnType<typeof setTimeout>|undefined;
  let onAbort:(()=>void)|undefined;
  try {
    await Promise.race([
      image.decode(),
      new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>reject(new Error('高清材质加载超时，请重新加载。')),timeoutMs);
        onAbort=()=>reject(signal.reason);
        signal.addEventListener('abort',onAbort,{once:true});
        // decode() can synchronously trigger cancellation before registration.
        if(signal.aborted)onAbort();
      }),
    ]);
    signal.throwIfAborted();
  } finally {
    if(timer!==undefined)clearTimeout(timer);
    if(onAbort)signal.removeEventListener('abort',onAbort);
  }
}

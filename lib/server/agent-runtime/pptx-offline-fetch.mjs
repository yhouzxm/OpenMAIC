/** Archive conversion must use only package-owned bytes, never external media/services. */
/** @param {typeof fetch} original @returns {typeof fetch} */
export function offlinePptxFetch(original) {
  return (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!/^(data:|blob:)/i.test(url))
      return Promise.reject(new Error('PPTX archive conversion forbids network access'));
    return original(input, init);
  };
}

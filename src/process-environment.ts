export function processEnvironment(): NodeJS.ProcessEnv {
  // A child task must not inherit the development terminal's Orca authority or paid API override.
  return Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^ORCA_|^CODEX_(THREAD_ID|INTERNAL_|API_KEY$)|^OPENAI_API_KEY$/i.test(key)));
}

/** Vite's worker entry import (the terminal runs through vinext/Vite). */
declare module '*?worker' {
  const WorkerEntry: new (options?: { name?: string }) => Worker;
  export default WorkerEntry;
}

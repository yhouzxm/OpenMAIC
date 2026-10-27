/** Optional published-course host policy; ordinary upstream classrooms keep their existing behavior. */
let published = false;
export function configurePublishedClassroomHost() {
  published = true;
}
export function isPublishedClassroomHost() {
  return published;
}

let autonomousPbl = false;
export function configurePublishedPbl(enabled: boolean) {
  autonomousPbl = enabled;
}
export function isPublishedPblEnabled() {
  return autonomousPbl;
}

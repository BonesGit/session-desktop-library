// RenderTextCallbackType (JSX-returning) was moved to ts/types/UITypes.ts to
// remove the React dependency from this file (included in the library build).
// Component files should import it from UITypes.ts instead.

export type DeepNullable<T> = {
  [P in keyof T]: T[P] extends object ? DeepNullable<T[P]> : T[P] | null;
};

// eslint-disable-next-line @typescript-eslint/array-type
export type NonEmptyArray<T> = [T, ...T[]];

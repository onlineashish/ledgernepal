/** First server validation message per field: { email: 'Enter a valid email address', ... } */
export function fieldErrors(error) {
  const result = {};
  for (const detail of error?.details ?? []) {
    if (detail?.field && !(detail.field in result)) result[detail.field] = detail.message;
  }
  return result;
}

/** A page-level message for errors that are not tied to one field. */
export function generalMessage(error) {
  if (!error) return null;
  return error.code === 'VALIDATION_FAILED' && Object.keys(fieldErrors(error)).length > 0 ? null : error.message;
}

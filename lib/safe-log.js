const SAFE_EVENT = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const SAFE_ERROR_CODE = /^[A-Z0-9_-]{1,32}$/i;

function normalizedEvent(event) {
  return SAFE_EVENT.test(event) ? event : 'application.invalid_log_event';
}

function errorFields(error) {
  if (!error || typeof error !== 'object') return {};
  const fields = {
    errorType: typeof error.name === 'string' && error.name.length <= 40
      ? error.name
      : 'Error'
  };
  if (typeof error.code === 'string' && SAFE_ERROR_CODE.test(error.code)) {
    fields.errorCode = error.code;
  }
  return fields;
}

function write(level, event, error) {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    event: normalizedEvent(event),
    ...errorFields(error)
  };
  const output = JSON.stringify(record);
  if (level === 'error') console.error(output);
  else if (level === 'warn') console.warn(output);
  else console.log(output);
}

module.exports = {
  info(event) {
    write('info', event);
  },
  warn(event) {
    write('warn', event);
  },
  error(event, error) {
    write('error', event, error);
  }
};

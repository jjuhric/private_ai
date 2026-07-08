class AppError extends Error {
  constructor(message, code, statusCode = 500) {
    super(message);
    this.name = this.constructor.name;
    this.code = code || 'INTERNAL_ERROR';
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

class QuotaExceededError extends AppError {
  constructor(message = 'API daily token quota exceeded.') {
    super(message, 'QUOTA_EXCEEDED', 429);
  }
}

class ServiceUnavailableError extends AppError {
  constructor(message = 'Service is temporarily unavailable.') {
    super(message, 'SERVICE_UNAVAILABLE', 503);
  }
}

class CommandExecutionError extends AppError {
  constructor(message = 'Command execution failed.') {
    super(message, 'COMMAND_FAILED', 500);
  }
}

module.exports = {
  AppError,
  QuotaExceededError,
  ServiceUnavailableError,
  CommandExecutionError
};

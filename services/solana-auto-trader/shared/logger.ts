// Logger utility with timestamp formatting

export class Logger {
  private static formatTime(): string {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  private static formatDate(): string {
    const now = new Date();
    return now.toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  }

  static info(service: string, message: string, data?: any) {
    const timestamp = `[${this.formatDate()} ${this.formatTime()}]`;
    console.log(`${timestamp} [${service}] INFO: ${message}`);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
  }

  static error(service: string, message: string, error?: any) {
    const timestamp = `[${this.formatDate()} ${this.formatTime()}]`;
    console.error(`${timestamp} [${service}] ERROR: ${message}`);
    if (error) {
      console.error(error);
    }
  }

  static warn(service: string, message: string, data?: any) {
    const timestamp = `[${this.formatDate()} ${this.formatTime()}]`;
    console.warn(`${timestamp} [${service}] WARN: ${message}`);
    if (data) {
      console.warn(JSON.stringify(data, null, 2));
    }
  }

  static success(service: string, message: string, data?: any) {
    const timestamp = `[${this.formatDate()} ${this.formatTime()}]`;
    console.log(`${timestamp} [${service}] ✓ SUCCESS: ${message}`);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
  }

  static validation(service: string, tokenAddress: string, passes: boolean, reasons: string[]) {
    const timestamp = `[${this.formatDate()} ${this.formatTime()}]`;
    const status = passes ? '✓ PASSES' : '✗ FAILS';
    console.log(`${timestamp} [${service}] ${status}: Token ${tokenAddress.substring(0, 8)}...`);
    reasons.forEach(reason => {
      console.log(`  ${passes ? '✓' : '✗'} ${reason}`);
    });
  }
}

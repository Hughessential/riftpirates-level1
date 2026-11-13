/** Current-run SCRAP only. Historical banked scrap never enters this wallet. */
export class RunWallet {
  constructor() { this.reset(); }
  reset() { this.earned = 0; this.spent = 0; this.balance = 0; }
  canSpend(amount) { return Number.isSafeInteger(amount) && amount >= 0 && amount <= this.balance; }
  credit(amount) {
    if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(this.earned + amount)) return false;
    this.earned += amount; this.balance += amount; return true;
  }
  spend(amount) {
    if (!this.canSpend(amount)) return false;
    this.spent += amount; this.balance -= amount; return true;
  }
  refund(amount) {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > this.spent) return false;
    this.spent -= amount; this.balance += amount; return true;
  }
}

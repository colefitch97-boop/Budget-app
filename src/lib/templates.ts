export interface TemplateGroup {
  name: string;
  categories: string[];
}

/** A starting set of categories; people pick what fits during setup. */
export const STARTER_CATEGORIES: TemplateGroup[] = [
  {
    name: 'Bills',
    categories: ['Rent or Mortgage', 'Electric', 'Water & Trash', 'Internet', 'Phone', 'Insurance', 'Car Payment'],
  },
  {
    name: 'Everyday',
    categories: ['Groceries', 'Gas & Parking', 'Household Supplies', 'Personal Care', 'Dining Out'],
  },
  {
    name: 'True Expenses',
    categories: ['Car Maintenance', 'Home Maintenance', 'Medical', 'Clothing', 'Gifts', 'Annual Subscriptions'],
  },
  {
    name: 'Quality of Life',
    categories: ['Entertainment', 'Streaming', 'Hobbies', 'Fitness', 'Fun Money'],
  },
  {
    name: 'Savings Goals',
    categories: ['Emergency Fund', 'Vacation', 'Next Car'],
  },
];

export const CURRENCIES: { code: string; label: string }[] = [
  { code: 'USD', label: 'US dollar ($)' },
  { code: 'CAD', label: 'Canadian dollar (CA$)' },
  { code: 'MXN', label: 'Mexican peso (MX$)' },
  { code: 'EUR', label: 'Euro (€)' },
  { code: 'GBP', label: 'British pound (£)' },
  { code: 'AUD', label: 'Australian dollar (A$)' },
];

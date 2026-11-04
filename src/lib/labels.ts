// Traducciones de enums internos al español.

export const projectStatusLabel: Record<string, string> = {
  quoted: "Presupuestado",
  approved: "Aprobado",
  in_progress: "En curso",
  paused: "Pausado",
  completed: "Finalizado",
  cancelled: "Cancelado",
};

export const projectStatusVariant: Record<string, string> = {
  quoted: "bg-muted text-muted-foreground",
  approved: "bg-primary/10 text-primary",
  in_progress: "bg-primary/15 text-primary",
  paused: "bg-warning/15 text-warning-foreground border border-warning/40",
  completed: "bg-success/15 text-success border border-success/30",
  cancelled: "bg-destructive/10 text-destructive",
};

export const taskStatusLabel: Record<string, string> = {
  pending: "Pendiente",
  in_progress: "En curso",
  completed: "Terminada",
  delayed: "Atrasada",
  cancelled: "Cancelada",
};

export const taskPriorityLabel: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
  urgent: "Urgente",
};

export const stageStatusLabel: Record<string, string> = {
  pending: "Pendiente",
  in_progress: "En curso",
  completed: "Terminada",
  cancelled: "Cancelada",
};

export const expenseCategoryLabel: Record<string, string> = {
  labor: "Mano de obra",
  materials: "Materiales",
  tools: "Herramientas",
  equipment_rental: "Alquiler de equipos",
  transport: "Transporte",
  fuel: "Combustible",
  subcontractors: "Subcontratos",
  travel_expenses: "Viáticos",
  supplies: "Insumos",
  other: "Otros",
};

export const paymentMethodLabel: Record<string, string> = {
  cash: "Efectivo",
  bank_transfer: "Transferencia",
  debit_card: "Tarjeta de débito",
  credit_card: "Tarjeta de crédito",
  check: "Cheque",
  mercado_pago: "Mercado Pago",
  other: "Otro",
};

export const generalExpenseCategoryLabel: Record<string, string> = {
  salaries: "Sueldos",
  fuel: "Combustible",
  maintenance: "Mantenimiento",
  services: "Servicios",
  accountant: "Contador",
  taxes: "Impuestos",
  general_travel_expenses: "Viáticos generales",
  personal_expenses: "Gastos personales",
  tools: "Herramientas",
  investments: "Inversiones",
  other: "Otros",
};

export const generalExpenseTypeLabel: Record<string, string> = {
  operational: "Operativo",
  personal: "Personal",
  investment: "Inversión",
};

export const generalExpenseStatusLabel: Record<string, string> = {
  paid: "Pagado",
  pending: "Pendiente",
  cancelled: "Anulado",
};

export const generalExpenseStatusVariant: Record<string, string> = {
  paid: "bg-success/15 text-success border border-success/30",
  pending: "bg-warning/15 text-warning-foreground border border-warning/40",
  cancelled: "bg-muted text-muted-foreground",
};

export const paymentAccountTypeLabel: Record<string, string> = {
  bank: "Banco",
  virtual_wallet: "Billetera virtual",
  cash: "Efectivo",
  credit: "Crédito",
  other: "Otro",
};

export const defaultGeneralExpenseType: Record<string, string> = {
  salaries: "operational",
  fuel: "operational",
  maintenance: "operational",
  services: "operational",
  accountant: "operational",
  taxes: "operational",
  general_travel_expenses: "operational",
  tools: "operational",
  investments: "investment",
  personal_expenses: "personal",
  other: "operational",
};

export const clientStatusLabel: Record<string, string> = {
  active: "Activo",
  inactive: "Inactivo",
};

export const currencyLabel: Record<string, string> = {
  ARS: "Pesos (ARS)",
  USD: "Dólares (USD)",
};

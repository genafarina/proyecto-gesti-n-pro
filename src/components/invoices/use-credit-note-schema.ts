import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isMissingCreditNoteSchema } from "@/lib/invoices";

export function useCreditNoteSchema() {
  return useQuery({
    queryKey: ["credit-note-schema"],
    retry: false,
    queryFn: async () => {
      // Explicit projections work even when the tables have no rows.
      const results = await Promise.all([
        supabase.from("invoice_balances").select("net_billed_amount").limit(0),
        supabase.from("invoice_project_balances").select("net_billed_amount").limit(0),
        supabase.from("credit_notes").select("id").limit(0),
        supabase.from("credit_note_projects").select("credit_note_id").limit(0),
      ]);
      for (const result of results) {
        if (result.error && !isMissingCreditNoteSchema(result.error)) throw result.error;
      }
      return results.every((result) => !result.error);
    },
  });
}

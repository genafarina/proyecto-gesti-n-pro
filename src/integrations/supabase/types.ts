export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      clients: {
        Row: {
          address: string | null
          code: string
          contact_name: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          name: string
          next_project_number: number
          notes: string | null
          phone: string | null
          status: Database["public"]["Enums"]["client_status"]
          tax_id: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          code: string
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name: string
          next_project_number?: number
          notes?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          tax_id?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          code?: string
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          name?: string
          next_project_number?: number
          notes?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          tax_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      credit_note_projects: {
        Row: {
          amount: number
          created_at: string
          credit_note_id: string
          invoice_id: string
          project_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          credit_note_id: string
          invoice_id: string
          project_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          credit_note_id?: string
          invoice_id?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_note_projects_note_fkey"
            columns: ["credit_note_id", "invoice_id"]
            isOneToOne: false
            referencedRelation: "credit_notes"
            referencedColumns: ["id", "invoice_id"]
          },
          {
            foreignKeyName: "credit_note_projects_invoice_project_fkey"
            columns: ["invoice_id", "project_id"]
            isOneToOne: false
            referencedRelation: "invoice_projects"
            referencedColumns: ["invoice_id", "project_id"]
          },
        ]
      }
      credit_note_revisions: {
        Row: {
          id: string
          credit_note_id: string
          previous_header: Json
          previous_projects: Json
          recorded_by: string | null
          recorded_at: string
        }
        Insert: {
          id?: string
          credit_note_id: string
          previous_header: Json
          previous_projects: Json
          recorded_by?: string | null
          recorded_at?: string
        }
        Update: {
          id?: string
          credit_note_id?: string
          previous_header?: Json
          previous_projects?: Json
          recorded_by?: string | null
          recorded_at?: string
        }
        Relationships: [{
          foreignKeyName: "credit_note_revisions_credit_note_id_fkey"
          columns: ["credit_note_id"]
          isOneToOne: false
          referencedRelation: "credit_notes"
          referencedColumns: ["id"]
        }]
      }
      credit_notes: {
        Row: {
          amount: number
          cancelled_at: string | null
          cancelled_by: string | null
          client_id: string
          created_at: string
          created_by: string | null
          credit_note_number: string
          currency: Database["public"]["Enums"]["currency_code"]
          document_type: string
          id: string
          invoice_id: string
          issue_date: string
          pdf_path: string | null
          point_of_sale: string
          reason: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount: number
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          credit_note_number: string
          currency?: Database["public"]["Enums"]["currency_code"]
          document_type: string
          id?: string
          invoice_id: string
          issue_date: string
          pdf_path?: string | null
          point_of_sale: string
          reason: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          credit_note_number?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          document_type?: string
          id?: string
          invoice_id?: string
          issue_date?: string
          pdf_path?: string | null
          point_of_sale?: string
          reason?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_notes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      general_expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          description: string
          expense_date: string
          expense_type: string
          id: string
          notes: string | null
          other_payment_account_detail: string | null
          payee: string | null
          payment_account_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          receipt_url: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          description: string
          expense_date: string
          expense_type: string
          id?: string
          notes?: string | null
          other_payment_account_detail?: string | null
          payee?: string | null
          payment_account_id: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          receipt_url?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          description?: string
          expense_date?: string
          expense_type?: string
          id?: string
          notes?: string | null
          other_payment_account_detail?: string | null
          payee?: string | null
          payment_account_id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          receipt_url?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "general_expenses_payment_account_id_fkey"
            columns: ["payment_account_id"]
            isOneToOne: false
            referencedRelation: "payment_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_allocations: {
        Row: {
          amount: number
          collection_id: string
          created_at: string
          created_by: string | null
          id: string
          invoice_id: string
          project_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          collection_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id: string
          project_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          collection_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_allocations_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "project_collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_allocations_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collection_allocation_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoice_balances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_allocations_project_fkey"
            columns: ["invoice_id", "project_id"]
            isOneToOne: false
            referencedRelation: "invoice_projects"
            referencedColumns: ["invoice_id", "project_id"]
          },
        ]
      }
      invoice_projects: {
        Row: {
          amount: number
          created_at: string
          invoice_id: string
          project_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          invoice_id: string
          project_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          invoice_id?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_projects_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_projects_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          client_id: string
          concept: string
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          document_type: string
          due_date: string | null
          id: string
          invoice_number: string
          issue_date: string
          net_amount: number | null
          notes: string | null
          pdf_path: string | null
          point_of_sale: string
          project_id: string
          status: string
          total_amount: number
          updated_at: string
          vat_amount: number | null
        }
        Insert: {
          client_id: string
          concept: string
          created_at?: string
          created_by?: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          document_type: string
          due_date?: string | null
          id?: string
          invoice_number: string
          issue_date: string
          net_amount?: number | null
          notes?: string | null
          pdf_path?: string | null
          point_of_sale: string
          project_id: string
          status?: string
          total_amount: number
          updated_at?: string
          vat_amount?: number | null
        }
        Update: {
          client_id?: string
          concept?: string
          created_at?: string
          created_by?: string | null
          currency?: Database["public"]["Enums"]["currency_code"]
          document_type?: string
          due_date?: string | null
          id?: string
          invoice_number?: string
          issue_date?: string
          net_amount?: number | null
          notes?: string | null
          pdf_path?: string | null
          point_of_sale?: string
          project_id?: string
          status?: string
          total_amount?: number
          updated_at?: string
          vat_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_accounts: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          notes: string | null
          type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active: boolean
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_collections: {
        Row: {
          amount: number
          client_id: string
          collection_date: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          notes: string | null
          payment_account_id: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          project_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          client_id: string
          collection_date?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          notes?: string | null
          payment_account_id?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          project_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          client_id?: string
          collection_date?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          notes?: string | null
          payment_account_id?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_collections_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_collections_payment_account_id_fkey"
            columns: ["payment_account_id"]
            isOneToOne: false
            referencedRelation: "payment_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_collections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_expenses: {
        Row: {
          amount: number
          category: Database["public"]["Enums"]["expense_category"]
          created_at: string
          created_by: string | null
          description: string | null
          expense_date: string
          id: string
          notes: string | null
          payment_account_id: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          project_id: string
          receipt_url: string | null
          subcategory: string | null
          supplier: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          category?: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          expense_date?: string
          id?: string
          notes?: string | null
          payment_account_id?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          project_id: string
          receipt_url?: string | null
          subcategory?: string | null
          supplier?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          expense_date?: string
          id?: string
          notes?: string | null
          payment_account_id?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          project_id?: string
          receipt_url?: string | null
          subcategory?: string | null
          supplier?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_expenses_payment_account_id_fkey"
            columns: ["payment_account_id"]
            isOneToOne: false
            referencedRelation: "payment_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_expenses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_stages: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          order_index: number
          project_id: string
          status: Database["public"]["Enums"]["stage_status"]
          updated_at: string
          weight_percentage: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          order_index?: number
          project_id: string
          status?: Database["public"]["Enums"]["stage_status"]
          updated_at?: string
          weight_percentage?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          order_index?: number
          project_id?: string
          status?: Database["public"]["Enums"]["stage_status"]
          updated_at?: string
          weight_percentage?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_stages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_tasks: {
        Row: {
          actual_end_date: string | null
          actual_start_date: string | null
          assigned_user_id: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          notes: string | null
          planned_end_date: string | null
          planned_start_date: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          progress_percentage: number
          project_id: string
          stage_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          updated_at: string
        }
        Insert: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          assigned_user_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          notes?: string | null
          planned_end_date?: string | null
          planned_start_date?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          progress_percentage?: number
          project_id: string
          stage_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string
        }
        Update: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          assigned_user_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          notes?: string | null
          planned_end_date?: string | null
          planned_start_date?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          progress_percentage?: number
          project_id?: string
          stage_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "project_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          actual_end_date: string | null
          actual_start_date: string | null
          client_id: string
          code: string
          contracted_amount: number
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          description: string | null
          estimated_amount: number
          estimated_cost: number
          id: string
          legacy_code: string | null
          manager_id: string | null
          name: string
          notes: string | null
          planned_end_date: string | null
          planned_start_date: string | null
          project_number: number
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
        }
        Insert: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          client_id: string
          code: string
          contracted_amount?: number
          created_at?: string
          created_by?: string | null
          currency?: Database["public"]["Enums"]["currency_code"]
          description?: string | null
          estimated_amount?: number
          estimated_cost?: number
          id?: string
          legacy_code?: string | null
          manager_id?: string | null
          name: string
          notes?: string | null
          planned_end_date?: string | null
          planned_start_date?: string | null
          project_number: number
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Update: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          client_id?: string
          code?: string
          contracted_amount?: number
          created_at?: string
          created_by?: string | null
          currency?: Database["public"]["Enums"]["currency_code"]
          description?: string | null
          estimated_amount?: number
          estimated_cost?: number
          id?: string
          legacy_code?: string | null
          manager_id?: string | null
          name?: string
          notes?: string | null
          planned_end_date?: string | null
          planned_start_date?: string | null
          project_number?: number
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      collection_allocation_summary: {
        Row: {
          allocated_amount: number | null
          amount: number | null
          client_id: string | null
          collection_date: string | null
          created_at: string | null
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"] | null
          description: string | null
          id: string | null
          notes: string | null
          payment_account_id: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          project_id: string | null
          unallocated_amount: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_collections_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_collections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_balances: {
        Row: {
          allocated_amount: number | null
          balance_due: number | null
          client_id: string | null
          concept: string | null
          credit_balance: number | null
          credit_note_amount: number | null
          created_at: string | null
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"] | null
          document_type: string | null
          due_date: string | null
          gross_amount: number | null
          id: string | null
          invoice_number: string | null
          issue_date: string | null
          net_amount: number | null
          net_billed_amount: number | null
          notes: string | null
          payment_status: string | null
          pdf_path: string | null
          point_of_sale: string | null
          project_id: string | null
          project_count: number | null
          project_ids: string[] | null
          status: string | null
          total_amount: number | null
          updated_at: string | null
          vat_amount: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_project_balances: {
        Row: {
          allocated_amount: number | null
          balance_due: number | null
          client_id: string | null
          concept: string | null
          credit_balance: number | null
          credit_note_amount: number | null
          currency: Database["public"]["Enums"]["currency_code"] | null
          document_type: string | null
          due_date: string | null
          invoice_id: string | null
          invoice_number: string | null
          issue_date: string | null
          net_billed_amount: number | null
          payment_status: string | null
          point_of_sale: string | null
          project_amount: number | null
          project_gross_amount: number | null
          project_id: string | null
          status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_projects_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_projects_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      allocate_collection_to_invoice_projects: {
        Args: {
          p_collection_id: string
          p_invoice_id: string
          p_projects: Json
        }
        Returns: undefined
      }
      cancel_credit_note: {
        Args: { p_credit_note_id: string }
        Returns: undefined
      }
      create_project_with_code: {
        Args: {
          _actual_end_date?: string
          _actual_start_date?: string
          _client_id: string
          _contracted_amount?: number
          _currency?: Database["public"]["Enums"]["currency_code"]
          _description?: string
          _estimated_amount?: number
          _estimated_cost?: number
          _name: string
          _notes?: string
          _planned_end_date?: string
          _planned_start_date?: string
          _status?: Database["public"]["Enums"]["project_status"]
        }
        Returns: {
          actual_end_date: string | null
          actual_start_date: string | null
          client_id: string
          code: string
          contracted_amount: number
          created_at: string
          created_by: string | null
          currency: Database["public"]["Enums"]["currency_code"]
          description: string | null
          estimated_amount: number
          estimated_cost: number
          id: string
          legacy_code: string | null
          manager_id: string | null
          name: string
          notes: string | null
          planned_end_date: string | null
          planned_start_date: string | null
          project_number: number
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      generate_client_code_base: { Args: { _name: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      save_invoice_with_projects: {
        Args: { p_invoice: Json; p_projects: Json }
        Returns: string
      }
      save_credit_note_with_projects: {
        Args: { p_credit_note: Json; p_projects: Json }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "supervisor" | "viewer"
      client_status: "active" | "inactive"
      currency_code: "ARS" | "USD"
      expense_category:
        | "labor"
        | "materials"
        | "tools"
        | "equipment_rental"
        | "transport"
        | "fuel"
        | "subcontractors"
        | "travel_expenses"
        | "supplies"
        | "other"
      payment_method:
        | "cash"
        | "bank_transfer"
        | "debit_card"
        | "credit_card"
        | "check"
        | "mercado_pago"
        | "other"
      project_status:
        | "quoted"
        | "approved"
        | "in_progress"
        | "paused"
        | "completed"
        | "cancelled"
      stage_status: "pending" | "in_progress" | "completed" | "cancelled"
      task_priority: "low" | "medium" | "high" | "urgent"
      task_status:
        | "pending"
        | "in_progress"
        | "completed"
        | "delayed"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "supervisor", "viewer"],
      client_status: ["active", "inactive"],
      currency_code: ["ARS", "USD"],
      expense_category: [
        "labor",
        "materials",
        "tools",
        "equipment_rental",
        "transport",
        "fuel",
        "subcontractors",
        "travel_expenses",
        "supplies",
        "other",
      ],
      payment_method: [
        "cash",
        "bank_transfer",
        "debit_card",
        "credit_card",
        "check",
        "mercado_pago",
        "other",
      ],
      project_status: [
        "quoted",
        "approved",
        "in_progress",
        "paused",
        "completed",
        "cancelled",
      ],
      stage_status: ["pending", "in_progress", "completed", "cancelled"],
      task_priority: ["low", "medium", "high", "urgent"],
      task_status: [
        "pending",
        "in_progress",
        "completed",
        "delayed",
        "cancelled",
      ],
    },
  },
} as const

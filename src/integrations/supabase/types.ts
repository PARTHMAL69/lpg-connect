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
      agencies: {
        Row: {
          address: string | null
          code: string
          created_at: string
          created_by: string | null
          default_language: string
          disabled_at: string | null
          id: string
          name: string
          phone: string | null
          status: Database["public"]["Enums"]["agency_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          default_language?: string
          disabled_at?: string | null
          id?: string
          name: string
          phone?: string | null
          status?: Database["public"]["Enums"]["agency_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          default_language?: string
          disabled_at?: string | null
          id?: string
          name?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["agency_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      agency_users: {
        Row: {
          agency_id: string | null
          created_at: string
          full_name: string | null
          id: string
          is_active: boolean
          is_platform_admin: boolean
          updated_at: string
          user_id: string
          username: string
        }
        Insert: {
          agency_id?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          is_platform_admin?: boolean
          updated_at?: string
          user_id: string
          username: string
        }
        Update: {
          agency_id?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          is_platform_admin?: boolean
          updated_at?: string
          user_id?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "agency_users_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_book_days: {
        Row: {
          actual_closing: number | null
          agency_id: string
          book_date: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          opening_cash: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          actual_closing?: number | null
          agency_id: string
          book_date: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          opening_cash?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          actual_closing?: number | null
          agency_id?: string
          book_date?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          opening_cash?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_book_days_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_ledger: {
        Row: {
          agency_id: string
          created_at: string
          credit: number
          customer_id: string
          debit: number
          description: string | null
          entry_date: string
          id: string
          kind: Database["public"]["Enums"]["ledger_entry_kind"]
          payment_id: string | null
          reference: string | null
          sale_id: string | null
        }
        Insert: {
          agency_id: string
          created_at?: string
          credit?: number
          customer_id: string
          debit?: number
          description?: string | null
          entry_date?: string
          id?: string
          kind: Database["public"]["Enums"]["ledger_entry_kind"]
          payment_id?: string | null
          reference?: string | null
          sale_id?: string | null
        }
        Update: {
          agency_id?: string
          created_at?: string
          credit?: number
          customer_id?: string
          debit?: number
          description?: string | null
          entry_date?: string
          id?: string
          kind?: Database["public"]["Enums"]["ledger_entry_kind"]
          payment_id?: string | null
          reference?: string | null
          sale_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_ledger_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_ledger_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_ledger_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_ledger_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          agency_id: string
          consumer_number: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          is_active: boolean
          is_deleted: boolean
          mobile: string | null
          name: string
          outstanding_balance: number
          txn_no: string | null
          updated_at: string
          updated_by: string | null
          village: string | null
        }
        Insert: {
          address?: string | null
          agency_id: string
          consumer_number?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          mobile?: string | null
          name: string
          outstanding_balance?: number
          txn_no?: string | null
          updated_at?: string
          updated_by?: string | null
          village?: string | null
        }
        Update: {
          address?: string | null
          agency_id?: string
          consumer_number?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          mobile?: string | null
          name?: string
          outstanding_balance?: number
          txn_no?: string | null
          updated_at?: string
          updated_by?: string | null
          village?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_boys: {
        Row: {
          agency_id: string
          created_at: string
          created_by: string | null
          default_commission: number
          deleted_at: string | null
          deleted_by: string | null
          id: string
          is_active: boolean
          is_deleted: boolean
          mobile: string | null
          name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          agency_id: string
          created_at?: string
          created_by?: string | null
          default_commission?: number
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          mobile?: string | null
          name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          agency_id?: string
          created_at?: string
          created_by?: string | null
          default_commission?: number
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          mobile?: string | null
          name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_boys_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_settlements: {
        Row: {
          agency_id: string
          collection_amount: number
          commission_kept: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          delivery_boy_id: string
          id: string
          is_deleted: boolean
          notes: string | null
          remarks: string | null
          settlement_date: string
          status: string
          submitted_amount: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          agency_id: string
          collection_amount?: number
          commission_kept?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          delivery_boy_id: string
          id?: string
          is_deleted?: boolean
          notes?: string | null
          remarks?: string | null
          settlement_date?: string
          status?: string
          submitted_amount?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          agency_id?: string
          collection_amount?: number
          commission_kept?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          delivery_boy_id?: string
          id?: string
          is_deleted?: boolean
          notes?: string | null
          remarks?: string | null
          settlement_date?: string
          status?: string
          submitted_amount?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_settlements_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_settlements_delivery_boy_id_fkey"
            columns: ["delivery_boy_id"]
            isOneToOne: false
            referencedRelation: "delivery_boys"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          agency_id: string
          amount: number
          category: Database["public"]["Enums"]["expense_category"]
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          delivery_boy_id: string | null
          expense_date: string
          id: string
          is_deleted: boolean
          notes: string | null
          txn_no: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          agency_id: string
          amount: number
          category: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          delivery_boy_id?: string | null
          expense_date?: string
          id?: string
          is_deleted?: boolean
          notes?: string | null
          txn_no?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          agency_id?: string
          amount?: number
          category?: Database["public"]["Enums"]["expense_category"]
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          delivery_boy_id?: string | null
          expense_date?: string
          id?: string
          is_deleted?: boolean
          notes?: string | null
          txn_no?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_delivery_boy_id_fkey"
            columns: ["delivery_boy_id"]
            isOneToOne: false
            referencedRelation: "delivery_boys"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          agency_id: string
          amount: number
          created_at: string
          created_by: string | null
          customer_id: string
          deleted_at: string | null
          deleted_by: string | null
          id: string
          is_deleted: boolean
          mode: Database["public"]["Enums"]["payment_receipt_mode"]
          payment_date: string
          remarks: string | null
          txn_no: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          agency_id: string
          amount: number
          created_at?: string
          created_by?: string | null
          customer_id: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          is_deleted?: boolean
          mode: Database["public"]["Enums"]["payment_receipt_mode"]
          payment_date?: string
          remarks?: string | null
          txn_no?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          agency_id?: string
          amount?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          is_deleted?: boolean
          mode?: Database["public"]["Enums"]["payment_receipt_mode"]
          payment_date?: string
          remarks?: string | null
          txn_no?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          agency_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          is_active: boolean
          is_deleted: boolean
          name: string
          rate: number
          requires_delivery_boy: boolean
          sku: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          agency_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          name: string
          rate?: number
          requires_delivery_boy?: boolean
          sku?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          agency_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          is_active?: boolean
          is_deleted?: boolean
          name?: string
          rate?: number
          requires_delivery_boy?: boolean
          sku?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          agency_id: string
          commission_amount: number
          commission_rate: number
          created_at: string
          created_by: string | null
          customer_id: string | null
          deleted_at: string | null
          deleted_by: string | null
          delivery_boy_id: string | null
          gross_amount: number
          id: string
          is_deleted: boolean
          net_amount: number
          notes: string | null
          payment_mode: Database["public"]["Enums"]["payment_mode"]
          product_id: string
          quantity: number
          rate: number
          sale_date: string
          txn_no: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          agency_id: string
          commission_amount?: number
          commission_rate?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          delivery_boy_id?: string | null
          gross_amount: number
          id?: string
          is_deleted?: boolean
          net_amount: number
          notes?: string | null
          payment_mode: Database["public"]["Enums"]["payment_mode"]
          product_id: string
          quantity?: number
          rate: number
          sale_date?: string
          txn_no?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          agency_id?: string
          commission_amount?: number
          commission_rate?: number
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          delivery_boy_id?: string | null
          gross_amount?: number
          id?: string
          is_deleted?: boolean
          net_amount?: number
          notes?: string | null
          payment_mode?: Database["public"]["Enums"]["payment_mode"]
          product_id?: string
          quantity?: number
          rate?: number
          sale_date?: string
          txn_no?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_delivery_boy_id_fkey"
            columns: ["delivery_boy_id"]
            isOneToOne: false
            referencedRelation: "delivery_boys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      txn_counters: {
        Row: {
          agency_id: string
          last_value: number
          prefix: string
          year: number
        }
        Insert: {
          agency_id: string
          last_value?: number
          prefix: string
          year: number
        }
        Update: {
          agency_id?: string
          last_value?: number
          prefix?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "txn_counters_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          agency_id: string | null
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          agency_id?: string | null
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          agency_id?: string | null
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "agencies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_outstanding_delta: {
        Args: { _customer_id: string; _delta: number }
        Returns: undefined
      }
      current_agency_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_platform_admin: { Args: { _user_id: string }; Returns: boolean }
      next_txn_no: {
        Args: { _agency_id: string; _prefix: string }
        Returns: string
      }
      platform_admin_exists: { Args: never; Returns: boolean }
    }
    Enums: {
      agency_status: "active" | "disabled"
      app_role: "platform_admin" | "agency_admin" | "agency_operator"
      expense_category:
        | "bank_deposit"
        | "vehicle_expense"
        | "fuel"
        | "repair"
        | "maintenance"
        | "salary"
        | "paytm_transfer"
        | "miscellaneous"
        | "delivery_boy_payment"
      ledger_entry_kind: "sale_credit" | "payment" | "adjustment"
      payment_mode: "cash" | "online" | "paytm" | "credit"
      payment_receipt_mode: "cash" | "online" | "paytm"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      agency_status: ["active", "disabled"],
      app_role: ["platform_admin", "agency_admin", "agency_operator"],
      expense_category: [
        "bank_deposit",
        "vehicle_expense",
        "fuel",
        "repair",
        "maintenance",
        "salary",
        "paytm_transfer",
        "miscellaneous",
        "delivery_boy_payment",
      ],
      ledger_entry_kind: ["sale_credit", "payment", "adjustment"],
      payment_mode: ["cash", "online", "paytm", "credit"],
      payment_receipt_mode: ["cash", "online", "paytm"],
    },
  },
} as const

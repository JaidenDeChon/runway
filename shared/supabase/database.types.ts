export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      accounts: {
        Row: {
          balance_as_of: string
          balance_cents: number
          color: string
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          balance_as_of: string
          balance_cents: number
          color: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          balance_as_of?: string
          balance_cents?: number
          color?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      occurrences: {
        Row: {
          account_id: string
          actual_amount_cents: number | null
          actual_date: string | null
          created_at: string
          id: string
          is_overridden: boolean
          projected_amount_cents: number
          projected_date: string
          rule_id: string
          status: Database["public"]["Enums"]["occurrence_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          actual_amount_cents?: number | null
          actual_date?: string | null
          created_at?: string
          id?: string
          is_overridden?: boolean
          projected_amount_cents: number
          projected_date: string
          rule_id: string
          status?: Database["public"]["Enums"]["occurrence_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          actual_amount_cents?: number | null
          actual_date?: string | null
          created_at?: string
          id?: string
          is_overridden?: boolean
          projected_amount_cents?: number
          projected_date?: string
          rule_id?: string
          status?: Database["public"]["Enums"]["occurrence_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "occurrences_account_fk"
            columns: ["user_id", "account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "occurrences_rule_fk"
            columns: ["user_id", "rule_id", "account_id"]
            isOneToOne: false
            referencedRelation: "recurring_rules"
            referencedColumns: ["user_id", "id", "account_id"]
          },
        ]
      }
      recurring_rules: {
        Row: {
          account_id: string
          amount_cents: number
          amount_source: Database["public"]["Enums"]["recurring_amount_source"]
          anchor_date: string
          cadence: Database["public"]["Enums"]["recurring_cadence"]
          created_at: string
          days_of_month: number[] | null
          days_of_week: number[] | null
          ends_on: string | null
          id: string
          is_variable: boolean
          kind: Database["public"]["Enums"]["recurring_kind"]
          name: string
          starts_on: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          amount_cents: number
          amount_source?: Database["public"]["Enums"]["recurring_amount_source"]
          anchor_date: string
          cadence: Database["public"]["Enums"]["recurring_cadence"]
          created_at?: string
          days_of_month?: number[] | null
          days_of_week?: number[] | null
          ends_on?: string | null
          id?: string
          is_variable?: boolean
          kind: Database["public"]["Enums"]["recurring_kind"]
          name: string
          starts_on?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          amount_cents?: number
          amount_source?: Database["public"]["Enums"]["recurring_amount_source"]
          anchor_date?: string
          cadence?: Database["public"]["Enums"]["recurring_cadence"]
          created_at?: string
          days_of_month?: number[] | null
          days_of_week?: number[] | null
          ends_on?: string | null
          id?: string
          is_variable?: boolean
          kind?: Database["public"]["Enums"]["recurring_kind"]
          name?: string
          starts_on?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_rules_account_fk"
            columns: ["user_id", "account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      rls_fixture_items: {
        Row: {
          created_at: string
          id: string
          label: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          user_id?: string
        }
        Relationships: []
      }
      transfers: {
        Row: {
          amount_cents: number
          created_at: string
          from_account_id: string
          id: string
          occurs_on: string
          to_account_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          from_account_id: string
          id?: string
          occurs_on: string
          to_account_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          from_account_id?: string
          id?: string
          occurs_on?: string
          to_account_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfers_from_account_fk"
            columns: ["user_id", "from_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["user_id", "id"]
          },
          {
            foreignKeyName: "transfers_to_account_fk"
            columns: ["user_id", "to_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
      user_settings: {
        Row: {
          created_at: string
          cushion_cents: number
          default_horizon_days: number
          discretionary_account_id: string | null
          monthly_discretionary_cents: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          cushion_cents?: number
          default_horizon_days?: number
          discretionary_account_id?: string | null
          monthly_discretionary_cents?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          cushion_cents?: number
          default_horizon_days?: number
          discretionary_account_id?: string | null
          monthly_discretionary_cents?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_settings_discretionary_account_fk"
            columns: ["user_id", "discretionary_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["user_id", "id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      occurrence_status: "projected" | "confirmed" | "skipped"
      recurring_amount_source: "fixed" | "predicted"
      recurring_cadence: "weekly" | "biweekly" | "monthly" | "annual"
      recurring_kind: "bill" | "income"
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
      occurrence_status: ["projected", "confirmed", "skipped"],
      recurring_amount_source: ["fixed", "predicted"],
      recurring_cadence: ["weekly", "biweekly", "monthly", "annual"],
      recurring_kind: ["bill", "income"],
    },
  },
} as const


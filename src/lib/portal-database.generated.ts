// Generated from the real local Supabase schema by scripts/portal-provider-types.ts.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      approve_and_queue_release: {
        Args: { p_digest: string; p_release: string };
        Returns: string;
      };
      authorise_job_dispatch: { Args: { p_job: string }; Returns: Json };
      begin_provisioning: {
        Args: { p_email: string; p_project: string; p_request: string };
        Returns: Json;
      };
      decide_revision: {
        Args: {
          p_decision: string;
          p_digest: string;
          p_expected_version: number;
          p_feedback?: string;
          p_note?: string;
          p_revision: string;
        };
        Returns: number;
      };
      get_event_administration: { Args: never; Returns: Json };
      get_my_projects: { Args: never; Returns: Json };
      get_people: { Args: never; Returns: Json };
      get_project_draft: { Args: { p_project: string }; Returns: Json };
      get_releases: { Args: never; Returns: Json };
      get_review_queue: { Args: never; Returns: Json };
      get_revision_preview: { Args: { p_revision: string }; Returns: Json };
      invitation_receipt: { Args: { p_request: string }; Returns: boolean };
      portal_context: { Args: never; Returns: Json };
      portal_storage_access: {
        Args: { bucket: string; obj: string; writing: boolean };
        Returns: boolean;
      };
      prepare_release: {
        Args: { p_revisions: string[]; p_source_commit: string };
        Returns: Json;
      };
      record_event_config: {
        Args: { p_config: Json; p_expected_version: number; p_themes: Json };
        Returns: number;
      };
      register_reviewed_source: {
        Args: { p_commit: string };
        Returns: undefined;
      };
      reserve_upload: {
        Args: { p_bytes: number; p_project: string; p_type: string };
        Returns: Json;
      };
      retry_job: { Args: { p_job: string }; Returns: undefined };
      revoke_asset: { Args: { p_asset: string }; Returns: undefined };
      save_project_draft: {
        Args: { p_expected_version: number; p_fields: Json; p_project: string };
        Returns: Json;
      };
      set_editing_open: { Args: { p_open: boolean }; Returns: undefined };
      set_event_role: {
        Args: { p_active: boolean; p_role: string; p_user: string };
        Returns: undefined;
      };
      set_membership: {
        Args: { p_active: boolean; p_project: string; p_user: string };
        Returns: undefined;
      };
      set_project_exclusion: {
        Args: { p_project: string; p_withdrawn: boolean };
        Returns: undefined;
      };
      submit_project_revision: {
        Args: {
          p_expected_version: number;
          p_project: string;
          p_request: string;
        };
        Returns: Json;
      };
      update_project_metadata: {
        Args: { p_expected_version: number; p_fields: Json; p_project: string };
        Returns: number;
      };
      worker_activation_check: {
        Args: { p_attempt: string; p_job: string };
        Returns: undefined;
      };
      worker_claim: { Args: { p_job: string; p_run: string }; Returns: Json };
      worker_cleanup_inventory: { Args: never; Returns: Json };
      worker_environment: { Args: never; Returns: Json };
      worker_fail: {
        Args: {
          p_activation_possible?: boolean;
          p_attempt: string;
          p_code: string;
          p_job: string;
        };
        Returns: undefined;
      };
      worker_finish_provisioning: {
        Args: { p_request: string; p_user: string };
        Returns: undefined;
      };
      worker_heartbeat: {
        Args: { p_attempt: string; p_job: string };
        Returns: undefined;
      };
      worker_prepare: {
        Args: {
          p_attempt: string;
          p_commit: string;
          p_digest: string;
          p_job: string;
          p_media: Json;
          p_snapshot: Json;
        };
        Returns: undefined;
      };
      worker_queued: { Args: never; Returns: Json };
      worker_reconcile: { Args: never; Returns: Json };
      worker_record_deployment: {
        Args: { p_attempt: string; p_job: string; p_receipt: Json };
        Returns: undefined;
      };
      worker_record_invitation: {
        Args: { p_request: string };
        Returns: undefined;
      };
      worker_recovery_unlock: {
        Args: { p_attempt: string; p_job: string; p_receipt: Json };
        Returns: undefined;
      };
      worker_seed_local: {
        Args: {
          p_event: Json;
          p_owner: string;
          p_projects: Json;
          p_source: string;
          p_themes: Json;
        };
        Returns: undefined;
      };
      worker_subject: {
        Args: { p_attempt: string; p_job: string };
        Returns: Json;
      };
      worker_verified: {
        Args: {
          p_attempt: string;
          p_job: string;
          p_manifest_digest: string;
          p_receipt: Json;
        };
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  'public'
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;

CREATE TABLE "agent_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"provider" text NOT NULL,
	"display_name" text NOT NULL,
	"endpoint_type" text NOT NULL,
	"endpoint" text,
	"encrypted_credentials" text,
	"credentials_preview" jsonb,
	"health_status" text DEFAULT 'untested' NOT NULL,
	"health_message" text,
	"last_tested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"owner_user_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"plan" text DEFAULT 'starter' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"dodo_customer_id" text,
	"dodo_subscription_id" text,
	"dodo_payment_id" text,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"event_type" text NOT NULL,
	"minutes" double precision DEFAULT 0 NOT NULL,
	"actions" integer DEFAULT 0 NOT NULL,
	"source_run_id" uuid,
	"source_experiment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "experiments" ADD COLUMN "agent_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "external_call_id" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "external_status" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "failure_summary" text;--> statement-breakpoint
ALTER TABLE "scenarios" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_source_run_id_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_source_experiment_id_experiments_id_fk" FOREIGN KEY ("source_experiment_id") REFERENCES "public"."experiments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_agent_connection_id_agent_connections_id_fk" FOREIGN KEY ("agent_connection_id") REFERENCES "public"."agent_connections"("id") ON DELETE no action ON UPDATE no action;
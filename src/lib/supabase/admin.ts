import { createClient } from '@supabase/supabase-js'

/**
 * Creates a privileged Supabase admin client with service role access.
 *
 * ⚠️ WARNING: This client BYPASSES all Row Level Security (RLS) policies.
 *
 * - Has full read/write access to the entire database
 * - Should ONLY be used in server-side code (API routes, Server Actions, Server Components)
 * - NEVER import or expose this client to browser/client components
 * - NEVER send the service role key to the client
 *
 * Use cases:
 * - Server-side administrative operations that need to bypass RLS
 * - Creating/updating records on behalf of users (with proper server-side validation)
 * - System-level operations (cleanup jobs, migrations, etc.)
 *
 * For normal authenticated operations that should respect RLS, use:
 * - `@/lib/supabase/server` for Server Components/Actions/Routes
 * - `@/lib/supabase/client` for Client Components
 *
 * Usage:
 * ```tsx
 * // Server-side only (API Route, Server Action, etc.)
 * import { createAdminClient } from '@/lib/supabase/admin'
 *
 * export async function POST(request: Request) {
 *   const supabase = createAdminClient()
 *
 *   // Validate input server-side before using admin client!
 *   const validated = validateInput(await request.json())
 *
 *   // This bypasses RLS - use with caution
 *   const { data } = await supabase
 *     .from('rooms')
 *     .insert(validated)
 *
 *   return Response.json(data)
 * }
 * ```
 */
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error(
      'Missing Supabase environment variables. Please check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are set.'
    )
  }

  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

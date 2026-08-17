# GitHub placement

Extract the contents of this folder into the repository root. Do not place the folder itself inside `artifacts/`.

The deployment fix is in the repository-root `Dockerfile`. The important build command is:

    RUN PORT=3000 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/dashboard run build

Keep these directories at the repository root:

- `artifacts/api-server/`
- `artifacts/dashboard/`
- `lib/api-client-react/`
- `lib/api-spec/`
- `lib/api-zod/`
- `lib/db/`
- `scripts/`

After uploading or committing the files, trigger a new Railway deployment. Do not upload `.env` files containing credentials; configure Railway variables separately.

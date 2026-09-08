SELECT format('CREATE DATABASE %I OWNER %I', 'omniroute_test', current_user)
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'omniroute_test')
\gexec

-- Table: public.users

-- DROP TABLE IF EXISTS public.users;

CREATE TABLE IF NOT EXISTS public.users
(
    id serial NOT NULL,
    username character varying(255) COLLATE pg_catalog."default",
    password text COLLATE pg_catalog."default",
    msn_user character varying(255) COLLATE pg_catalog."default",
    msn_pwd character varying(255) COLLATE pg_catalog."default",
    imap text COLLATE pg_catalog."default",
    xmpp_user character varying(255) COLLATE pg_catalog."default",
    mobile character varying(255) COLLATE pg_catalog."default",
    pbkdf2 bytea,
    salt bytea,
    password_hash text COLLATE pg_catalog."default",
    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT users_username_key UNIQUE (username),
    CONSTRAINT users_username_key1 UNIQUE (username, password)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.users
    OWNER to organizator_prod;

ALTER TABLE IF EXISTS public.users
    ENABLE ROW LEVEL SECURITY;

ALTER TABLE IF EXISTS public.users
    FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.users FROM auth;

GRANT SELECT ON TABLE public.users TO auth;

GRANT ALL ON TABLE public.users TO organizator_prod;
-- POLICY: select_policy

-- DROP POLICY IF EXISTS select_policy ON public.users;

CREATE POLICY select_policy
    ON public.users
    AS PERMISSIVE
    FOR SELECT
    TO public
    USING (true);
-- POLICY: update_policy

-- DROP POLICY IF EXISTS update_policy ON public.users;

CREATE POLICY update_policy
    ON public.users
    AS PERMISSIVE
    FOR UPDATE
    TO public
    USING ((((current_setting('organizator.current_user'::text))::integer = id) OR ((current_setting('organizator.current_user'::text))::integer = 1)));

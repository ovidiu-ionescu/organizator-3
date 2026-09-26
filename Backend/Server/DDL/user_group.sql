-- Table: public.user_group

-- DROP TABLE IF EXISTS public.user_group;

CREATE TABLE IF NOT EXISTS public.user_group
(
    id serial NOT NULL,
    user_group_name character varying(255) COLLATE pg_catalog."default",
    user_id integer,
    CONSTRAINT user_group_pkey PRIMARY KEY (id)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.user_group
    OWNER to organizator_prod;

REVOKE ALL ON TABLE public.user_group FROM auth;

GRANT SELECT ON TABLE public.user_group TO auth;

GRANT ALL ON TABLE public.user_group TO organizator_prod;

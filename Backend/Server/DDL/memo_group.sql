-- Table: public.memo_group

-- DROP TABLE IF EXISTS public.memo_group;

CREATE TABLE IF NOT EXISTS public.memo_group
(
    id serial NOT NULL,
    name character varying(255) COLLATE pg_catalog."default" NOT NULL DEFAULT ''::character varying,
    user_id integer,
    public boolean,
    CONSTRAINT memo_group_pkey PRIMARY KEY (id)
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.memo_group
    OWNER to organizator_prod;

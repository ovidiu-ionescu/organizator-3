-- Table: public.user_group_detail

-- DROP TABLE IF EXISTS public.user_group_detail;

CREATE TABLE IF NOT EXISTS public.user_group_detail
(
    id serial NOT NULL,
    user_group_id integer,
    user_id integer,
    CONSTRAINT user_group_detail_pkey PRIMARY KEY (id),
    CONSTRAINT user_group_detail_user_group_id_fkey FOREIGN KEY (user_group_id)
        REFERENCES public.user_group (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT user_group_detail_user_id_fkey FOREIGN KEY (user_id)
        REFERENCES public.users (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.user_group_detail
    OWNER to organizator_prod;
-- Index: user_group_detail_user_group_id_idx

-- DROP INDEX IF EXISTS public.user_group_detail_user_group_id_idx;

CREATE INDEX IF NOT EXISTS user_group_detail_user_group_id_idx
    ON public.user_group_detail USING btree
    (user_group_id ASC NULLS LAST)
    TABLESPACE pg_default;
-- Index: user_group_detail_user_id_idx

-- DROP INDEX IF EXISTS public.user_group_detail_user_id_idx;

CREATE INDEX IF NOT EXISTS user_group_detail_user_id_idx
    ON public.user_group_detail USING btree
    (user_id ASC NULLS LAST)
    TABLESPACE pg_default;

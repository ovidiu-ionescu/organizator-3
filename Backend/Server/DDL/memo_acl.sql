-- Table: public.memo_acl

-- DROP TABLE IF EXISTS public.memo_acl;

CREATE TABLE IF NOT EXISTS public.memo_acl
(
    id serial NOT NULL,
    memo_group_id integer,
    user_group_id integer,
    access integer,
    CONSTRAINT memo_acl_pkey PRIMARY KEY (id),
    CONSTRAINT memo_acl_memo_group_id_user_group_id_key UNIQUE (memo_group_id, user_group_id),
    CONSTRAINT memo_acl_memo_group_id_fkey FOREIGN KEY (memo_group_id)
        REFERENCES public.memo_group (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT memo_acl_user_group_id_fkey FOREIGN KEY (user_group_id)
        REFERENCES public.user_group (id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE
)

TABLESPACE pg_default;

ALTER TABLE IF EXISTS public.memo_acl
    OWNER to organizator_prod;
-- Index: memo_acl_memo_group_id_idx

-- DROP INDEX IF EXISTS public.memo_acl_memo_group_id_idx;

CREATE INDEX IF NOT EXISTS memo_acl_memo_group_id_idx
    ON public.memo_acl USING btree
    (memo_group_id ASC NULLS LAST)
    TABLESPACE pg_default;
-- Index: memo_acl_user_group_id_idx

-- DROP INDEX IF EXISTS public.memo_acl_user_group_id_idx;

CREATE INDEX IF NOT EXISTS memo_acl_user_group_id_idx
    ON public.memo_acl USING btree
    (user_group_id ASC NULLS LAST)
    TABLESPACE pg_default;

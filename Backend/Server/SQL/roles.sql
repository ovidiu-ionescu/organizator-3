-- 1. Create the Roles table
CREATE TABLE roles (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Create the User_Roles junction table
CREATE TABLE user_roles (
    user_id BIGINT NOT NULL,
    role_id BIGINT NOT NULL,
    assigned_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    
    -- Composite primary key prevents duplicate role assignments per user
    PRIMARY KEY (user_id, role_id),
    
    -- Foreign key to your existing users table (CASCADE deletes user_roles if user is deleted)
    CONSTRAINT fk_user 
        FOREIGN KEY (user_id) 
        REFERENCES users(id) 
        ON DELETE CASCADE,
        
    -- Foreign key to roles table (CASCADE deletes user_roles if role is deleted)
    CONSTRAINT fk_role 
        FOREIGN KEY (role_id) 
        REFERENCES roles(id) 
        ON DELETE CASCADE
);

INSERT into roles (name, description) VALUES
('orgadm', 'Organizator administrator'),
('org', 'Organizator user'),
('photo', 'Access to photos')
;

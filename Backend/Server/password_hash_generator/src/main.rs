use std::process;

use argon2::{
    Argon2, PasswordHasher as _,
    password_hash::{SaltString, rand_core::OsRng},
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("Generate password hash");
    let password = rpassword::prompt_password("Your password: ").unwrap();
    let password_repeat = rpassword::prompt_password("Repeat password: ").unwrap();
    if password != password_repeat {
        eprintln!("The two passwords are not the same.");
        process::exit(1);
    }
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)?
        .to_string();
    println!("Password hash: {password_hash}\n");
    println!(
        "UPDATE users SET password_hash='{password_hash}' where username = 'user';"
    );
    Ok(())
}

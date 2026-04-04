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
        "UPDATE users SET password_hash='$argon2id$v=19$m=19456,t=2,p=1$n6VXkP6364F+UtcNuifA4Q$s6WtbrAs/Vk4vwmJX12o4331hwQ6SoGgDjQyxxH8wNY' where username = 'user';"
    );
    Ok(())
}

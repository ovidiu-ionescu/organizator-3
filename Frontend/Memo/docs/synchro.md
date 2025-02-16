# Synchronization between server and client

# Intro
Every memo fetched is stored in the database as local and server. 
Initially the two are the same but the local value can be changed.
Also the corresponding server instance could be changed by another app 
instance.

### Notations:
 - λ timestamp of local memo instance
 - σ timestamp the memo had when it was fetched from the server
 - ρ timestamp of the memo on the server

 ### Cases

 - λ = σ = ρ nothing has changed, the editor should show the initial value
 - ρ = σ < λ the local value has changed
 - λ = σ < ρ server value has changed, it should replace the local value
 - σ < (λ, ρ) both server remote and local have been changed, need to merge

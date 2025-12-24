# clean up wallets

psql postgresql://copytrader:copytrader_dev_password@localhost:5432/copytrader -c "DELETE FROM followed_wallets;"

